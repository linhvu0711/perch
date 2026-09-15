import path from 'node:path';

import { zValidator } from '@hono/zod-validator';
import {
  itemTagsBodySchema,
  postCreateSchema,
  postDeleteBodySchema,
  postIdsBodySchema,
  postLinksBodySchema,
  postListQuerySchema,
  postMediaAttachBodySchema,
  postMediaDetachBodySchema,
  postPatchSchema,
  postScheduleBodySchema,
} from '@perch/core';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppDeps, AppEnv } from '../app';
import {
  createPost,
  deletePosts,
  getPost,
  linkResources,
  listPosts,
  mediaRowForPost,
  previewPost,
  unlinkResources,
  updatePost,
} from '../db/posts';
import { getSettings } from '../db/settings';
import { tagPosts, untagPosts } from '../db/tags';
import { notFound, validationHook } from '../errors';
import { MediaAttachError } from '../media';
import { InFlightError, PostNotReadyError } from '../postLifecycle';

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export function postsRoutes(deps: AppDeps) {
  function refuseInFlight(id: number): void {
    if (deps.lifecycle.isInFlight(id)) throw new InFlightError(id);
  }
  return new Hono<AppEnv>()
    .get('/', zValidator('query', postListQuerySchema, validationHook), (c) => {
      const userId = c.get('user').id;
      return c.json(
        listPosts(
          deps.db,
          userId,
          c.req.valid('query'),
          getSettings(deps.db, userId).timezone,
          deps.clock.now(),
          deps.media.exists,
        ),
        200,
      );
    })
    .post('/', zValidator('json', postCreateSchema, validationHook), async (c) => {
      const userId = c.get('user').id;
      const body = c.req.valid('json');
      const post = createPost(deps.db, userId, body, deps.clock.now(), deps.media.exists);
      const imageIds = new Set(
        post.links.filter((link) => link.type === 'image').map((link) => link.resource_id),
      );
      const sources = (body.from ?? []).filter((id) => imageIds.has(id));
      if (sources.length > 0) {
        let attached: Awaited<ReturnType<typeof deps.media.attachFromResources>>;
        try {
          attached = await deps.media.attachFromResources(userId, post.id, sources);
        } catch (error) {
          deletePosts(deps.db, userId, [post.id], (postId) => deps.media.removeAll(userId, postId));
          throw error;
        }
        if (!attached) throw new Error('post insert failed');
        const failed = attached.results.filter((item) => !item.ok);
        if (failed.length > 0) {
          deletePosts(deps.db, userId, [post.id], (postId) => deps.media.removeAll(userId, postId));
          throw new MediaAttachError(failed.map((item) => item.error.message));
        }
      }
      if (body.official === true) {
        const result = deps.lifecycle.promote(userId, [post.id]).results[0];
        if (result !== undefined && result.ok === false) {
          deletePosts(deps.db, userId, [post.id], (postId) => deps.media.removeAll(userId, postId));
          throw new PostNotReadyError(
            result.error.errors ?? [{ path: 'status', message: result.error.message }],
          );
        }
        const fresh = getPost(deps.db, userId, post.id, deps.clock.now(), deps.media.exists);
        if (!fresh) throw notFound('Post', post.id);
        return c.json(fresh, 201);
      }
      const created = getPost(deps.db, userId, post.id, deps.clock.now(), deps.media.exists);
      if (!created) throw new Error('post insert failed');
      return c.json(created, 201);
    })
    .post('/tags', zValidator('json', itemTagsBodySchema, validationHook), (c) => {
      const body = c.req.valid('json');
      return c.json(tagPosts(deps.db, c.get('user').id, body.ids, body.tags), 200);
    })
    .delete('/tags', zValidator('json', itemTagsBodySchema, validationHook), (c) => {
      const body = c.req.valid('json');
      return c.json(untagPosts(deps.db, c.get('user').id, body.ids, body.tags), 200);
    })
    .post('/promote', zValidator('json', postIdsBodySchema, validationHook), (c) => {
      const userId = c.get('user').id;
      return c.json(deps.lifecycle.promote(userId, c.req.valid('json').ids), 200);
    })
    .post('/demote', zValidator('json', postIdsBodySchema, validationHook), (c) => {
      return c.json(deps.lifecycle.demote(c.get('user').id, c.req.valid('json').ids), 200);
    })
    .post('/unschedule', zValidator('json', postIdsBodySchema, validationHook), (c) => {
      return c.json(deps.lifecycle.unschedule(c.get('user').id, c.req.valid('json').ids), 200);
    })
    .post('/dismiss', zValidator('json', postIdsBodySchema, validationHook), (c) => {
      return c.json(deps.lifecycle.dismiss(c.get('user').id, c.req.valid('json').ids), 200);
    })
    .post(
      '/:id/schedule',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', postScheduleBodySchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const userId = c.get('user').id;
        const post = deps.lifecycle.schedule(userId, id, c.req.valid('json'));
        if (!post) throw notFound('Post', id);
        return c.json(post, 200);
      },
    )
    .post('/:id/publish', zValidator('param', idParamSchema, validationHook), async (c) => {
      const { id } = c.req.valid('param');
      const userId = c.get('user').id;
      const post = await deps.lifecycle.publishNow(userId, id);
      if (!post) throw notFound('Post', id);
      return c.json(post, 200);
    })
    .post('/:id/retry', zValidator('param', idParamSchema, validationHook), async (c) => {
      const { id } = c.req.valid('param');
      const userId = c.get('user').id;
      const post = await deps.lifecycle.retry(userId, id);
      if (!post) throw notFound('Post', id);
      return c.json(post, 200);
    })
    .get('/:id', zValidator('param', idParamSchema, validationHook), (c) => {
      const { id } = c.req.valid('param');
      const post = getPost(deps.db, c.get('user').id, id, deps.clock.now(), deps.media.exists);
      if (!post) throw notFound('Post', id);
      return c.json(post, 200);
    })
    .get('/:id/preview', zValidator('param', idParamSchema, validationHook), (c) => {
      const { id } = c.req.valid('param');
      const preview = previewPost(deps.db, c.get('user').id, id);
      if (!preview) throw notFound('Post', id);
      return c.json(preview, 200);
    })
    .patch(
      '/:id',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', postPatchSchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        refuseInFlight(id);
        const post = updatePost(
          deps.db,
          c.get('user').id,
          id,
          c.req.valid('json'),
          deps.clock.now(),
          deps.media.exists,
        );
        if (!post) throw notFound('Post', id);
        return c.json(post, 200);
      },
    )
    .post(
      '/:id/media',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', postMediaAttachBodySchema, validationHook),
      async (c) => {
        const { id } = c.req.valid('param');
        const userId = c.get('user').id;
        refuseInFlight(id);
        const result = await deps.media.attachFromResources(
          userId,
          id,
          c.req.valid('json').resource_ids,
        );
        if (!result) throw notFound('Post', id);
        return c.json(result, 200);
      },
    )
    .post(
      '/:id/media/files',
      zValidator('param', idParamSchema, validationHook),
      zValidator(
        'form',
        z.object({
          files: z.union([z.instanceof(File), z.array(z.instanceof(File))]),
        }),
        validationHook,
      ),
      async (c) => {
        const { id } = c.req.valid('param');
        const userId = c.get('user').id;
        refuseInFlight(id);
        const formFiles = c.req.valid('form').files;
        const files = Array.isArray(formFiles) ? formFiles : [formFiles];

        const inputs = [];
        for (const file of files) {
          inputs.push({ name: file.name, bytes: await file.bytes() });
        }

        const response = await deps.media.attachFromFiles(userId, id, inputs);
        if (!response) throw notFound('Post', id);
        return c.json(response, 200);
      },
    )
    .get(
      '/:id/media/:mediaId/file',
      zValidator(
        'param',
        z.object({ id: z.coerce.number().int().positive(), mediaId: z.coerce.number().int() }),
        validationHook,
      ),
      (c) => {
        const { id, mediaId } = c.req.valid('param');
        const mediaRow = mediaRowForPost(deps.db, c.get('user').id, id, mediaId);
        if (!mediaRow) throw notFound('Post', id);
        return new Response(Bun.file(path.join(deps.uploadDir, mediaRow.path)), {
          headers: {
            'Content-Type': mediaRow.mime,
            'Cache-Control': 'private, max-age=31536000, immutable',
          },
        });
      },
    )
    .delete(
      '/:id/media',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', postMediaDetachBodySchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const userId = c.get('user').id;
        refuseInFlight(id);
        const post = deps.media.detach(userId, id, c.req.valid('json'));
        if (!post) throw notFound('Post', id);
        return c.json({ media: post.media }, 200);
      },
    )
    .post(
      '/:id/links',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', postLinksBodySchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const result = linkResources(
          deps.db,
          c.get('user').id,
          id,
          c.req.valid('json').resource_ids,
        );
        if (!result) throw notFound('Post', id);
        return c.json(result, 200);
      },
    )
    .delete(
      '/:id/links',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', postLinksBodySchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const result = unlinkResources(
          deps.db,
          c.get('user').id,
          id,
          c.req.valid('json').resource_ids,
        );
        if (!result) throw notFound('Post', id);
        return c.json(result, 200);
      },
    )
    .delete('/', zValidator('json', postDeleteBodySchema, validationHook), (c) => {
      const userId = c.get('user').id;
      return c.json(
        deletePosts(
          deps.db,
          userId,
          c.req.valid('json').ids,
          (postId) => deps.media.removeAll(userId, postId),
          (id) => deps.lifecycle.isInFlight(id),
        ),
        200,
      );
    });
}
