import { zValidator } from '@hono/zod-validator';
import { tagCreateSchema, tagDeleteBodySchema, tagRenameSchema } from '@perch/core';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppDeps, AppEnv } from '../app';
import { createTag, deleteTags, listTags, renameTag } from '../db/tags';
import { notFound, validationHook } from '../errors';

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export function tagsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get('/', (c) => c.json(listTags(deps.db, c.get('user').id), 200))
    .post('/', zValidator('json', tagCreateSchema, validationHook), (c) => {
      const { name } = c.req.valid('json');
      return c.json(createTag(deps.db, c.get('user').id, name), 201);
    })
    .patch(
      '/:id',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', tagRenameSchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const { name } = c.req.valid('json');
        const tag = renameTag(deps.db, c.get('user').id, id, name);
        if (!tag) throw notFound('Tag', id);
        return c.json(tag, 200);
      },
    )
    .delete('/', zValidator('json', tagDeleteBodySchema, validationHook), (c) =>
      c.json(deleteTags(deps.db, c.get('user').id, c.req.valid('json').ids), 200),
    );
}
