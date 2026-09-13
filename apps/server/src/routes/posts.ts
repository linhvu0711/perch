import {
  postCreateSchema,
  postDeleteBodySchema,
  postLinksBodySchema,
  postListQuerySchema,
  postPatchSchema,
} from '@perch/core';
import { zValidator } from '@hono/zod-validator';
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
  previewPost,
  unlinkResources,
  updatePost,
} from '../db/posts';
import { getSettings } from '../db/settings';
import { ApiError, validationHook } from '../errors';

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

function notFound(id: number): ApiError {
  return new ApiError(404, 'not_found', `Post ${id} not found`);
}

export function postsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get(
      '/',
      zValidator('query', postListQuerySchema, validationHook),
      (c) => {
        try {
          const userId = c.get('user').id;
          return c.json(
            listPosts(
              deps.db,
              userId,
              c.req.valid('query'),
              getSettings(deps.db, userId).timezone,
            ),
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
      },
    )
    .post(
      '/',
      zValidator('json', postCreateSchema, validationHook),
      (c) => {
        try {
          return c.json(
            createPost(
              deps.db,
              c.get('user').id,
              c.req.valid('json'),
              deps.clock.now(),
            ),
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
      },
    )
    .get(
      '/:id',
      zValidator('param', idParamSchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const post = getPost(deps.db, c.get('user').id, id);
        if (!post) throw notFound(id);
        return c.json(post, 200);
      },
    )
    .get(
      '/:id/preview',
      zValidator('param', idParamSchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const preview = previewPost(deps.db, c.get('user').id, id);
        if (!preview) throw notFound(id);
        return c.json(preview, 200);
      },
    )
    .patch(
      '/:id',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', postPatchSchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const post = updatePost(
          deps.db,
          c.get('user').id,
          id,
          c.req.valid('json'),
          deps.clock.now(),
        );
        if (!post) throw notFound(id);
        return c.json(post, 200);
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
        if (!result) throw notFound(id);
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
        if (!result) throw notFound(id);
        return c.json(result, 200);
      },
    )
    .delete(
      '/',
      zValidator('json', postDeleteBodySchema, validationHook),
      (c) =>
        c.json(
          deletePosts(deps.db, c.get('user').id, c.req.valid('json').ids),
          200,
        ),
    );
}
