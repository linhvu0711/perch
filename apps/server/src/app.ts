import { Hono } from 'hono';

import { authMiddleware, type User } from './auth';
import type { Clock } from './clock';
import type { Db } from './db';
import { errorHandler, notFoundHandler } from './errors';
import { authRoutes } from './routes/auth';
import { settingsRoutes } from './routes/settings';
import { statusRoutes } from './routes/status';
import { staticHandler } from './static';

export type AppEnv = { Variables: { user: User } };

export interface AppDeps {
  db: Db;
  token: string;
  webDist: string;
  clock: Clock;
}

function createRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .basePath('/api')
    .use('*', authMiddleware(deps.token))
    .route('/auth', authRoutes(deps))
    .route('/settings', settingsRoutes(deps))
    .route('/status', statusRoutes(deps));
}

export type AppType = ReturnType<typeof createRoutes>;

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', createRoutes(deps));
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.get('*', staticHandler(deps.webDist));
  return app;
}
