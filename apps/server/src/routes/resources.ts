import path from 'node:path';
import { zValidator } from '@hono/zod-validator';
import {
  itemTagsBodySchema,
  NOTE_TITLE_FALLBACK,
  noteCreateSchema,
  RESOURCE_BATCH_MAX,
  RESOURCE_TITLE_MAX,
  resourceDeleteBodySchema,
  resourceListQuerySchema,
  resourcePatchSchema,
  tagNameSchema,
  tweetCreateSchema,
} from '@perch/core';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';

import type { AppDeps, AppEnv } from '../app';
import {
  createImage,
  createNote,
  deleteResources,
  getResource,
  listAllResources,
  listResources,
  listTweetAuthors,
  updateResource,
} from '../db/resources';
import { tagResources, untagResources } from '../db/tags';
import { ApiError, notFound, validationHook } from '../errors';
import { copyToR2, inspectImage, removeImage, storeImage } from '../images';

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export function resourcesRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get('/', zValidator('query', resourceListQuerySchema, validationHook), (c) =>
      c.json(listResources(deps.db, c.get('user').id, c.req.valid('query')), 200),
    )
    .post('/notes', zValidator('json', noteCreateSchema, validationHook), (c) =>
      c.json(createNote(deps.db, c.get('user').id, c.req.valid('json'), deps.clock.now()), 201),
    )
    .post('/tweets', zValidator('json', tweetCreateSchema, validationHook), async (c) =>
      c.json(await deps.tweets.saveTweets(c.get('user').id, c.req.valid('json')), 200),
    )
    .get('/authors', (c) => c.json(listTweetAuthors(deps.db, c.get('user').id), 200))
    .post('/images', async (c) => {
      const form = await c.req.formData();
      const files = form.getAll('files').filter((v): v is File => v instanceof File);
      if (files.length === 0) {
        throw new ApiError(400, 'validation', 'Invalid request', [
          { path: 'files', message: 'At least one file is required' },
        ]);
      }
      if (files.length > RESOURCE_BATCH_MAX) {
        throw new ApiError(400, 'validation', 'Invalid request', [
          { path: 'files', message: 'At most 100 files' },
        ]);
      }

      const titleRaw = form.get('title');
      let title: string | undefined;
      if (titleRaw !== null) {
        if (files.length !== 1) {
          throw new ApiError(400, 'validation', 'Invalid request', [
            { path: 'title', message: 'title needs exactly one file' },
          ]);
        }
        const parsed = z.string().trim().min(1).max(RESOURCE_TITLE_MAX).safeParse(titleRaw);
        if (!parsed.success) {
          throw new ApiError(400, 'validation', 'Invalid request', [
            {
              path: 'title',
              message: parsed.error.issues[0]?.message ?? 'Invalid title',
            },
          ]);
        }
        title = parsed.data;
      }

      const tags: string[] = [];
      for (const value of form.getAll('tags')) {
        const parsed = tagNameSchema.safeParse(value);
        if (!parsed.success) {
          throw new ApiError(400, 'validation', 'Invalid request', [
            {
              path: 'tags',
              message: parsed.error.issues[0]?.message ?? 'Invalid tag',
            },
          ]);
        }
        tags.push(parsed.data);
      }

      const results = [];
      for (const file of files) {
        const bytes = await file.bytes();
        const inspected = await inspectImage(bytes);
        if (!inspected.ok) {
          results.push({ name: file.name, ok: false as const, error: inspected.error });
          continue;
        }
        const rel = await storeImage(deps.uploadDir, c.get('user').id, bytes, inspected.ext);
        await copyToR2(deps.r2, rel, bytes, deps.logError);
        const resource = createImage(
          deps.db,
          c.get('user').id,
          {
            title: (title ?? file.name).trim().slice(0, RESOURCE_TITLE_MAX) || NOTE_TITLE_FALLBACK,
            notes: '',
            path: rel,
            mime: inspected.mime,
            bytes: bytes.length,
            width: inspected.width,
            height: inspected.height,
            tags,
          },
          deps.clock.now(),
          (rel) => removeImage(deps.uploadDir, rel),
        );
        results.push({ name: file.name, ok: true as const, resource });
      }
      return c.json({ results }, 200);
    })
    .get('/export', (c) => {
      c.header('Content-Type', 'application/x-ndjson');
      return stream(c, async (s) => {
        for (const r of listAllResources(deps.db, c.get('user').id)) {
          const { used_by: _usedBy, ...line } = r;
          await s.write(`${JSON.stringify(line)}\n`);
        }
      });
    })
    .post('/tags', zValidator('json', itemTagsBodySchema, validationHook), (c) => {
      const body = c.req.valid('json');
      return c.json(tagResources(deps.db, c.get('user').id, body.ids, body.tags), 200);
    })
    .delete('/tags', zValidator('json', itemTagsBodySchema, validationHook), (c) => {
      const body = c.req.valid('json');
      return c.json(untagResources(deps.db, c.get('user').id, body.ids, body.tags), 200);
    })
    .get('/:id', zValidator('param', idParamSchema, validationHook), (c) => {
      const { id } = c.req.valid('param');
      const resource = getResource(deps.db, c.get('user').id, id);
      if (!resource) throw notFound('Resource', id);
      return c.json(resource, 200);
    })
    .get('/:id/file', zValidator('param', idParamSchema, validationHook), (c) => {
      const { id } = c.req.valid('param');
      const resource = getResource(deps.db, c.get('user').id, id);
      if (!resource) throw notFound('Resource', id);
      if (resource.type !== 'image') {
        throw new ApiError(404, 'not_found', `Resource ${id} has no file`);
      }
      return new Response(Bun.file(path.join(deps.uploadDir, resource.path)), {
        headers: {
          'Content-Type': resource.mime,
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      });
    })
    .patch(
      '/:id',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', resourcePatchSchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const patch = c.req.valid('json');
        const stored = getResource(deps.db, c.get('user').id, id);
        if (!stored) throw notFound('Resource', id);
        const resource = updateResource(deps.db, c.get('user').id, id, patch);
        if (!resource) throw notFound('Resource', id);
        return c.json(resource, 200);
      },
    )
    .delete('/', zValidator('json', resourceDeleteBodySchema, validationHook), (c) =>
      c.json(
        deleteResources(deps.db, c.get('user').id, c.req.valid('json').ids, (rel) =>
          removeImage(deps.uploadDir, rel),
        ),
        200,
      ),
    );
}
