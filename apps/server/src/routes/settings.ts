import { zValidator } from '@hono/zod-validator';
import { settingsPatchSchema } from '@perch/core';
import { Hono } from 'hono';

import type { AppDeps, AppEnv } from '../app';
import { getSettings, updateSettings } from '../db/settings';
import { validationHook } from '../errors';

export function settingsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get('/', (c) => c.json(getSettings(deps.db, c.get('user').id), 200))
    .patch('/', zValidator('json', settingsPatchSchema, validationHook), (c) =>
      c.json(updateSettings(deps.db, c.get('user').id, c.req.valid('json')), 200),
    );
}
