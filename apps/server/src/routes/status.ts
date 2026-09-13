import { Hono } from 'hono';

import type { AppDeps, AppEnv } from '../app';
import { monthCostUsd } from '../db/apiCalls';
import { getSettings } from '../db/settings';

export function statusRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().get('/', (c) => {
    const settings = getSettings(deps.db, c.get('user').id);
    const user = c.get('user');
    return c.json(
      {
        timezone: settings.timezone,
        month_cost_usd: monthCostUsd(deps.db, user.id, deps.clock.now()),
      },
      200,
    );
  });
}
