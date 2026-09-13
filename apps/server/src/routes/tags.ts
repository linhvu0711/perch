import { zValidator } from '@hono/zod-validator';
import { tagCreateSchema } from '@perch/core';
import { Hono } from 'hono';

import type { AppDeps, AppEnv } from '../app';
import { TagExistsError } from '../db/posts';
import { createTag, listTags } from '../db/tags';
import { ApiError, validationHook } from '../errors';

export function tagsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get('/', (c) => c.json(listTags(deps.db, c.get('user').id), 200))
    .post('/', zValidator('json', tagCreateSchema, validationHook), (c) => {
      const { name } = c.req.valid('json');
      try {
        return c.json(createTag(deps.db, c.get('user').id, name), 201);
      } catch (error) {
        if (error instanceof TagExistsError) {
          throw new ApiError(400, 'validation', 'Invalid request', [
            { path: 'name', message: `Tag "${error.tagName}" already exists` },
          ]);
        }
        throw error;
      }
    });
}
