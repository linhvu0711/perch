import { zValidator } from '@hono/zod-validator';
import {
  itemTagsBodySchema,
  postCreateSchema,
  postDeleteBodySchema,
  postLinksBodySchema,
  postListQuerySchema,
  postPatchSchema,
} from '@perch/core';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppDeps, AppEnv } from '../app';
import {
  createPost,
  deletePosts,
  getPost,
  InvalidPostCursorError,
  linkResources,
  listPosts,
  MissingResourceError,
  PostImmutableError,
  previewPost,
  unlinkResources,
  updatePost,
} from '../db/posts';
import { getSettings } from '../db/settings';
import { tagPosts, untagPosts } from '../db/tags';
import { ApiError, validationHook } from '../errors';

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
    .post('/', zValidator('json', postCreateSchema, validationHook), (c) => {
      try {
        return c.json(
          createPost(deps.db, c.get('user').id, c.req.valid('json'), deps.clock.now()),
          201,
        );
      } catch (error) {
        if (error instanceof MissingResourceError) {
          throw new ApiError(400, 'validation', 'Invalid request', [
            { path: 'from', message: `Resource ${error.resourceId} not found` },
          ]);
        }
        throw error;
      }
    })
    .post('/tags', zValidator('json', itemTagsBodySchema, validationHook), (c) => {
      const body = c.req.valid('json');
      return c.json(tagPosts(deps.db, c.get('user').id, body.ids, body.tags), 200);
    })
    .delete('/tags', zValidator('json', itemTagsBodySchema, validationHook), (c) => {
      const body = c.req.valid('json');
      return c.json(untagPosts(deps.db, c.get('user').id, body.ids, body.tags), 200);
    })
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
    .delete('/', zValidator('json', postDeleteBodySchema, validationHook), (c) =>
      c.json(deletePosts(deps.db, c.get('user').id, c.req.valid('json').ids), 200),
    );
}
