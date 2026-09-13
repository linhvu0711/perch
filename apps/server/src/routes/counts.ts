import { Hono } from 'hono';

import type { AppDeps, AppEnv } from '../app';
import { countAll } from '../db/counts';

export function countsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().get('/', (c) => c.json(countAll(deps.db, c.get('user').id), 200));
}
