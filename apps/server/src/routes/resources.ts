import {
  noteCreateSchema,
  resourceDeleteBodySchema,
  resourceListQuerySchema,
  resourcePatchSchema,
} from '@perch/core';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppDeps, AppEnv } from '../app';
import {
  createNote,
  deleteResources,
  getResource,
  InvalidCursorError,
  listResources,
  updateResource,
} from '../db/resources';
import { ApiError, validationHook } from '../errors';

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
    .patch(
      '/:id',
      zValidator('param', idParamSchema, validationHook),
      zValidator('json', resourcePatchSchema, validationHook),
      (c) => {
        const { id } = c.req.valid('param');
        const resource = updateResource(
          deps.db,
          c.get('user').id,
          id,
          c.req.valid('json'),
        );
        if (!resource) throw notFound(id);
        return c.json(resource, 200);
      },
    )
    .delete(
      '/',
      zValidator('json', resourceDeleteBodySchema, validationHook),
      (c) =>
        c.json(
          deleteResources(deps.db, c.get('user').id, c.req.valid('json').ids),
          200,
        ),
    );
}
