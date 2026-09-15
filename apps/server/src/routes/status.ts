import { Hono } from 'hono';

import type { AppDeps, AppEnv } from '../app';
import { getSettings } from '../db/settings';
import { statusSnapshot } from '../db/status';

export function statusRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().get('/', (c) => {
    const user = c.get('user');
    const settings = getSettings(deps.db, user.id);
    return c.json(
      statusSnapshot(
        deps.db,
        user.id,
        settings.timezone,
        deps.clock.now(),
        deps.media.exists,
      ),
      200,
    );
  });
}
