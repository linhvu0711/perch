import fs from 'node:fs';
import path from 'node:path';

import { zValidator } from '@hono/zod-validator';
import {
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
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppDeps, AppEnv } from '../app';
import {
  attachFromFiles,
  attachFromResources,
  detachMedia,
  type MediaFiles,
  MissingMediaPositionError,
} from '../db/postMedia';
import {
  createPost,
  deletePosts,
  demotePosts,
  getPost,
  InvalidPostCursorError,
  linkResources,
  listPosts,
  MediaLimitError,
  MissingResourceError,
  PostImmutableError,
  PostNotReadyError,
  PostStatusError,
  previewPost,
  promotePosts,
  ScheduleTimeError,
  schedulePost,
  unlinkResources,
  unschedulePosts,
  updatePost,
} from '../db/posts';
import { postMedia, posts } from '../db/schema';
import { getSettings } from '../db/settings';
import { ApiError, validationHook } from '../errors';
import { inspectImage, readMedia, removeMedia, removeMediaDir, storeMedia } from '../images';

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

function notFound(id: number): ApiError {
  return new ApiError(404, 'not_found', `Post ${id} not found`);
}

function immutable(error: unknown): ApiError {
  if (error instanceof PostImmutableError) {
    return new ApiError(400, 'validation', 'Invalid request', [
      { path: 'status', message: `Post ${error.postId} is published` },
    ]);
  }
  throw error;
}

function mediaLimit(error: unknown): ApiError {
  if (error instanceof MediaLimitError) {
    return new ApiError(400, 'validation', 'Invalid request', [
      { path: error.path, message: 'At most 4 media per post' },
    ]);
  }
  throw error;
}

const mediaFiles = (deps: AppDeps, userId: number): MediaFiles => ({
  read: (rel) => readMedia(deps.uploadDir, rel),
  store: (postId, bytes, ext) => storeMedia(deps.uploadDir, userId, postId, bytes, ext),
  remove: (rel) => removeMedia(deps.uploadDir, rel),
});

export function postsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get('/', zValidator('query', postListQuerySchema, validationHook), (c) => {
      try {
        const userId = c.get('user').id;
        return c.json(
          listPosts(deps.db, userId, c.req.valid('query'), getSettings(deps.db, userId).timezone),
          200,
        );
      } catch (error) {
        if (error instanceof InvalidPostCursorError) {
          throw new ApiError(400, 'validation', 'Invalid request', [
            { path: 'cursor', message: 'Invalid cursor' },
          ]);
        }
        throw error;
      }
    })
    .post('/', zValidator('json', postCreateSchema, validationHook), async (c) => {
      const userId = c.get('user').id;
      try {
        return c.json(
          await createPost(
            deps.db,
            userId,
            c.req.valid('json'),
            deps.clock.now(),
            mediaFiles(deps, userId),
          ),
          201,
        );
      } catch (error) {
        if (error instanceof MediaLimitError) throw mediaLimit(error);
        if (error instanceof PostNotReadyError) {
          throw new ApiError(400, 'validation', 'Invalid request', error.errors);
        }
        if (error instanceof MissingResourceError) {
          throw new ApiError(400, 'validation', 'Invalid request', [
            { path: 'from', message: `Resource ${error.resourceId} not found` },
          ]);
        }
        throw error;
      }
    })
    .post('/promote', zValidator('json', postIdsBodySchema, validationHook), (c) => {
      const userId = c.get('user').id;
      return c.json(
        promotePosts(
          deps.db,
          userId,
          c.req.valid('json').ids,
          (rel) => fs.existsSync(path.join(deps.uploadDir, rel)),
          deps.clock.now(),
        ),
        200,
      );
    })
    .post('/demote', zValidator('json', postIdsBodySchema, validationHook), (c) => {
      return c.json(
        demotePosts(deps.db, c.get('user').id, c.req.valid('json').ids, deps.clock.now()),
        200,
      );
    })
    .post('/unschedule', zValidator('json', postIdsBodySchema, validationHook), (c) => {
      return c.json(
        unschedulePosts(deps.db, c.get('user').id, c.req.valid('json').ids, deps.clock.now()),
        200,
      );
    })
    .post(
      '/:id/schedule',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', postScheduleBodySchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const userId = c.get('user').id;
        try {
          const post = schedulePost(
            deps.db,
            userId,
            id,
            c.req.valid('json'),
            getSettings(deps.db, userId).timezone,
            deps.clock.now(),
          );
          if (!post) throw notFound(id);
          return c.json(post, 200);
        } catch (error) {
          if (error instanceof ScheduleTimeError) {
            throw new ApiError(400, 'validation', 'Invalid request', [
              { path: 'at', message: error.message },
            ]);
          }
          if (error instanceof PostStatusError) {
            throw new ApiError(400, 'validation', 'Invalid request', [
              { path: 'status', message: error.message },
            ]);
          }
          throw immutable(error);
        }
      },
    )
    .get('/:id', zValidator('param', idParamSchema, validationHook), (c) => {
      const { id } = c.req.valid('param');
      const post = getPost(deps.db, c.get('user').id, id);
      if (!post) throw notFound(id);
      return c.json(post, 200);
    })
    .get('/:id/preview', zValidator('param', idParamSchema, validationHook), (c) => {
      const { id } = c.req.valid('param');
      const preview = previewPost(deps.db, c.get('user').id, id);
      if (!preview) throw notFound(id);
      return c.json(preview, 200);
    })
    .patch(
      '/:id',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', postPatchSchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        try {
          const post = updatePost(
            deps.db,
            c.get('user').id,
            id,
            c.req.valid('json'),
            deps.clock.now(),
          );
          if (!post) throw notFound(id);
          return c.json(post, 200);
        } catch (error) {
          throw immutable(error);
        }
      },
    )
    .post(
      '/:id/media',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', postMediaAttachBodySchema, validationHook),
      async (c) => {
        const { id } = c.req.valid('param');
        const userId = c.get('user').id;
        try {
          const result = await attachFromResources(
            deps.db,
            userId,
            id,
            c.req.valid('json').resource_ids,
            mediaFiles(deps, userId),
          );
          if (!result) throw notFound(id);
          return c.json(result, 200);
        } catch (error) {
          if (error instanceof MediaLimitError) throw mediaLimit(error);
          throw immutable(error);
        }
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
        const formFiles = c.req.valid('form').files;
        const files = Array.isArray(formFiles) ? formFiles : [formFiles];

        const inputs = [];
        const results: Array<
          | { name: string; ok: true }
          | { name: string; ok: false; error: { code: string; message: string } }
        > = [];
        for (const file of files) {
          const bytes = await file.bytes();
          const inspected = await inspectImage(bytes);
          if (!inspected.ok) {
            results.push({ name: file.name, ok: false, error: inspected.error });
            continue;
          }
          inputs.push({ name: file.name, bytes, mime: inspected.mime, ext: inspected.ext });
          results.push({ name: file.name, ok: true });
        }

        try {
          const response = await attachFromFiles(
            deps.db,
            userId,
            id,
            inputs,
            mediaFiles(deps, userId),
          );
          if (!response) throw notFound(id);
          let index = 0;
          const merged = results.map((result) => {
            if (!result.ok) return result;
            const attached = response.results[index];
            index += 1;
            return attached ?? result;
          });
          return c.json({ results: merged }, 200);
        } catch (error) {
          if (error instanceof MediaLimitError) throw mediaLimit(error);
          throw immutable(error);
        }
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
        const row = deps.db
          .select({ media: postMedia })
          .from(postMedia)
          .innerJoin(posts, eq(postMedia.postId, posts.id))
          .where(
            and(
              eq(postMedia.postId, id),
              eq(postMedia.id, mediaId),
              eq(posts.userId, c.get('user').id),
            ),
          )
          .get();
        if (!row) throw notFound(id);
        const mediaRow = row.media;
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
        try {
          const post = detachMedia(deps.db, userId, id, c.req.valid('json'), (rel) =>
            removeMedia(deps.uploadDir, rel),
          );
          if (!post) throw notFound(id);
          return c.json({ media: post.media }, 200);
        } catch (error) {
          if (error instanceof MediaLimitError) throw mediaLimit(error);
          if (error instanceof MissingMediaPositionError) {
            throw new ApiError(400, 'validation', 'Invalid request', [
              { path: 'positions', message: `No media at position ${error.position}` },
            ]);
          }
          throw immutable(error);
        }
      },
    )
    .post(
      '/:id/links',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', postLinksBodySchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        try {
          const result = linkResources(
            deps.db,
            c.get('user').id,
            id,
            c.req.valid('json').resource_ids,
          );
          if (!result) throw notFound(id);
          return c.json(result, 200);
        } catch (error) {
          throw immutable(error);
        }
      },
    )
    .delete(
      '/:id/links',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', postLinksBodySchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        try {
          const result = unlinkResources(
            deps.db,
            c.get('user').id,
            id,
            c.req.valid('json').resource_ids,
          );
          if (!result) throw notFound(id);
          return c.json(result, 200);
        } catch (error) {
          throw immutable(error);
        }
      },
    )
    .delete('/', zValidator('json', postDeleteBodySchema, validationHook), (c) => {
      const userId = c.get('user').id;
      return c.json(
        deletePosts(deps.db, userId, c.req.valid('json').ids, (postId) =>
          removeMediaDir(deps.uploadDir, userId, postId),
        ),
        200,
      );
    });
}
