import path from 'node:path';

import {
  NOTE_TITLE_FALLBACK,
  noteCreateSchema,
  RESOURCE_BATCH_MAX,
  RESOURCE_TITLE_MAX,
  resourceDeleteBodySchema,
  resourceListQuerySchema,
  resourcePatchSchema,
  type Resource,
} from '@perch/core';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';

import type { AppDeps, AppEnv } from '../app';
import {
  createImage,
  createNote,
  deleteResources,
  getResource,
  InvalidCursorError,
  listAllResources,
  listResources,
  updateResource,
} from '../db/resources';
import { ApiError, validationHook } from '../errors';
import { inspectImage, removeImage, storeImage } from '../images';

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

function notFound(id: number): ApiError {
  return new ApiError(404, 'not_found', `Resource ${id} not found`);
}

export function resourcesRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get(
      '/',
      zValidator('query', resourceListQuerySchema, validationHook),
      (c) => {
        try {
          return c.json(
            listResources(deps.db, c.get('user').id, c.req.valid('query')),
            200,
          );
        } catch (error) {
          if (error instanceof InvalidCursorError) {
            throw new ApiError(400, 'validation', 'Invalid request', [
              { path: 'cursor', message: 'Invalid cursor' },
            ]);
          }
          throw error;
        }
      },
    )
    .post(
      '/notes',
      zValidator('json', noteCreateSchema, validationHook),
      (c) =>
        c.json(
          createNote(
            deps.db,
            c.get('user').id,
            c.req.valid('json'),
            deps.clock.now(),
          ),
          201,
        ),
    )
    .post('/images', async (c) => {
      const form = await c.req.formData();
      const files = form
        .getAll('files')
        .filter((v): v is File => v instanceof File);
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
        const parsed = z
          .string()
          .trim()
          .min(1)
          .max(RESOURCE_TITLE_MAX)
          .safeParse(titleRaw);
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

      const results = [];
      for (const file of files) {
        const bytes = await file.bytes();
        const inspected = await inspectImage(bytes);
        if (!inspected.ok) {
          results.push({ name: file.name, ok: false as const, error: inspected.error });
          continue;
        }
        const rel = await storeImage(deps.uploadDir, c.get('user').id, bytes, inspected.ext);
        let resource: Resource;
        try {
          resource = createImage(
            deps.db,
            c.get('user').id,
            {
              title:
                (title ?? file.name).trim().slice(0, RESOURCE_TITLE_MAX) ||
                NOTE_TITLE_FALLBACK,
              notes: '',
              path: rel,
              mime: inspected.mime,
              bytes: bytes.length,
              width: inspected.width,
              height: inspected.height,
            },
            deps.clock.now(),
          );
        } catch (error) {
          removeImage(deps.uploadDir, rel);
          throw error;
        }
        results.push({ name: file.name, ok: true as const, resource });
      }
      return c.json({ results }, 200);
    })
    .get('/export', (c) => {
      c.header('Content-Type', 'application/x-ndjson');
      return stream(c, async (s) => {
        for (const r of listAllResources(deps.db, c.get('user').id)) {
          await s.write(JSON.stringify(r) + '\n');
        }
      });
    })
    .get(
      '/:id',
      zValidator('param', idParamSchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const resource = getResource(deps.db, c.get('user').id, id);
        if (!resource) throw notFound(id);
        return c.json(resource, 200);
      },
    )
    .get(
      '/:id/file',
      zValidator('param', idParamSchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const resource = getResource(deps.db, c.get('user').id, id);
        if (!resource) throw notFound(id);
        if (resource.type !== 'image') {
          throw new ApiError(404, 'not_found', `Resource ${id} has no file`);
        }
        return new Response(
          Bun.file(path.join(deps.uploadDir, resource.path)),
          {
            headers: {
              'Content-Type': resource.mime,
              'Cache-Control': 'private, max-age=31536000, immutable',
            },
          },
        );
      },
    )
    .patch(
      '/:id',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', resourcePatchSchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const patch = c.req.valid('json');
        const stored = getResource(deps.db, c.get('user').id, id);
        if (!stored) throw notFound(id);
        if (stored.type === 'image' && patch.body !== undefined) {
          throw new ApiError(400, 'validation', 'Invalid request', [
            { path: 'body', message: 'Only notes have a body' },
          ]);
        }
        const resource = updateResource(deps.db, c.get('user').id, id, patch);
        if (!resource) throw notFound(id);
        return c.json(resource, 200);
      },
    )
    .delete(
      '/',
      zValidator('json', resourceDeleteBodySchema, validationHook),
      (c) =>
        c.json(
          deleteResources(
            deps.db,
            c.get('user').id,
            c.req.valid('json').ids,
            (rel) => removeImage(deps.uploadDir, rel),
          ),
          200,
        ),
    );
}
