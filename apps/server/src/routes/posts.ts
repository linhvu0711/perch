import { postCreateSchema } from '@perch/core';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppDeps, AppEnv } from '../app';
import { createPost, getPost, MissingResourceError } from '../db/posts';
import { ApiError, validationHook } from '../errors';

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

function notFound(id: number): ApiError {
  return new ApiError(404, 'not_found', `Post ${id} not found`);
}

export function postsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
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
    );
}
