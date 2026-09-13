import { zValidator } from '@hono/zod-validator';
import { calendarQuerySchema } from '@perch/core';
import { Hono } from 'hono';

import type { AppDeps, AppEnv } from '../app';
import { calendarDays } from '../db/posts';
import { getSettings } from '../db/settings';
import { validationHook } from '../errors';

export function calendarRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().get(
    '/',
    zValidator('query', calendarQuerySchema, validationHook),
    (c) => {
      const userId = c.get('user').id;
      return c.json(
        calendarDays(
          deps.db,
          userId,
          c.req.valid('query'),
          getSettings(deps.db, userId).timezone,
          deps.clock.now(),
        ),
        200,
      );
    },
  );
}
