import { zValidator } from '@hono/zod-validator';
import { costHistoryQuerySchema, costSummaryQuerySchema } from '@perch/core';
import { Hono } from 'hono';

import type { AppDeps, AppEnv } from '../app';
import { costHistory, costSummary } from '../db/apiCalls';
import { getSettings } from '../db/settings';
import { ApiError, validationHook } from '../errors';

export function costsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get('/', zValidator('query', costSummaryQuerySchema, validationHook), (c) => {
      const userId = c.get('user').id;
      const timeZone = getSettings(deps.db, userId).timezone;
      return c.json(
        costSummary(deps.db, userId, timeZone, deps.clock.now(), c.req.valid('query').month),
        200,
      );
    })
    .get('/months', zValidator('query', costHistoryQuerySchema, validationHook), (c) => {
      const userId = c.get('user').id;
      const timeZone = getSettings(deps.db, userId).timezone;
      const history = costHistory(deps.db, userId, timeZone, c.req.valid('query'));
      if (history === null) {
        throw new ApiError(400, 'validation', 'Invalid request', [
          { path: 'cursor', message: 'Invalid cursor' },
        ]);
      }
      return c.json(history, 200);
    });
}
