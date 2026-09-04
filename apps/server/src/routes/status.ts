import { Hono } from 'hono';

import type { AppDeps, AppEnv } from '../app';
import { getSettings } from '../db/settings';

export function statusRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().get('/', (c) => {
    const settings = getSettings(deps.db, c.get('user').id);
    return c.json({ timezone: settings.timezone }, 200);
  });
}
