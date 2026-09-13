import { Hono } from 'hono';

import type { AppDeps, AppEnv } from '../app';

export function accountRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().get('/', (c) =>
    c.json(deps.accounts.status(c.get('user').id), 200),
  );
}
