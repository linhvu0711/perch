import { zValidator } from '@hono/zod-validator';
import { tagCreateSchema, tagDeleteBodySchema, tagRenameSchema } from '@perch/core';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppDeps, AppEnv } from '../app';
import { TagExistsError } from '../db/posts';
import { createTag, deleteTags, listTags, renameTag } from '../db/tags';
import { ApiError, validationHook } from '../errors';

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

function tagExists(error: TagExistsError): ApiError {
  return new ApiError(400, 'validation', 'Invalid request', [
    { path: 'name', message: `Tag "${error.tagName}" already exists` },
  ]);
}

export function tagsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get('/', (c) => c.json(listTags(deps.db, c.get('user').id), 200))
    .post('/', zValidator('json', tagCreateSchema, validationHook), (c) => {
      const { name } = c.req.valid('json');
      try {
        return c.json(createTag(deps.db, c.get('user').id, name), 201);
      } catch (error) {
        if (error instanceof TagExistsError) throw tagExists(error);
        throw error;
      }
    })
    .patch(
      '/:id',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', tagRenameSchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const { name } = c.req.valid('json');
        try {
          const tag = renameTag(deps.db, c.get('user').id, id, name);
          if (!tag) throw new ApiError(404, 'not_found', `Tag ${id} not found`);
          return c.json(tag, 200);
        } catch (error) {
          if (error instanceof TagExistsError) throw tagExists(error);
          throw error;
        }
      },
    )
    .delete('/', zValidator('json', tagDeleteBodySchema, validationHook), (c) =>
      c.json(deleteTags(deps.db, c.get('user').id, c.req.valid('json').ids), 200),
    );
}
