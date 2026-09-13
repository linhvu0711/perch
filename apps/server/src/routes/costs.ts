import { zValidator } from '@hono/zod-validator';
import { costHistoryQuerySchema, costSummaryQuerySchema, zonedParts } from '@perch/core';
import { Hono } from 'hono';

import type { AppDeps, AppEnv } from '../app';
import { costHistory, costSummary } from '../db/apiCalls';
import { getSettings } from '../db/settings';
import { ApiError, validationHook } from '../errors';

export function costsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get('/', zValidator('query', costHistoryQuerySchema, validationHook), (c) => {
      const userId = c.get('user').id;
      const timeZone = getSettings(deps.db, userId).timezone;
      const history = costHistory(deps.db, userId, c.req.valid('query'), timeZone);
      if (history === null) {
        throw new ApiError(400, 'validation', 'Invalid request', [
          { path: 'cursor', message: 'Invalid cursor' },
        ]);
      }
      return c.json(history, 200);
    })
    .get('/summary', zValidator('query', costSummaryQuerySchema, validationHook), (c) => {
      const userId = c.get('user').id;
      const timeZone = getSettings(deps.db, userId).timezone;
      const month =
        c.req.valid('query').month ?? zonedParts(deps.clock.now(), timeZone).date.slice(0, 7);
      return c.json(costSummary(deps.db, userId, month, timeZone), 200);
    });
}
