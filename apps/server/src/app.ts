import { Hono } from 'hono';

import { authMiddleware, type User } from './auth';
import type { Clock } from './clock';
import type { Db } from './db';
import { errorHandler, notFoundHandler } from './errors';
import type { MediaService } from './media';
import type { PostLifecycle } from './postLifecycle';
import type { R2Client } from './r2/client';
import { accountRoutes } from './routes/account';
import { authRoutes } from './routes/auth';
import { calendarRoutes } from './routes/calendar';
import { costsRoutes } from './routes/costs';
import { countsRoutes } from './routes/counts';
import { healthRoutes } from './routes/health';
import { postsRoutes } from './routes/posts';
import { resourcesRoutes } from './routes/resources';
import { settingsRoutes } from './routes/settings';
import { statusRoutes } from './routes/status';
import { tagsRoutes } from './routes/tags';
import { xCallbackHandler } from './routes/xCallback';
import { staticHandler } from './static';
import type { XAccountService } from './x/accounts';
import type { TweetService } from './x/tweets';

export type AppEnv = { Variables: { user: User } };

export interface AppDeps {
  db: Db;
  token: string;
  secureCookies: boolean;
  webDist: string;
  uploadDir: string;
  clock: Clock;
  accounts: XAccountService;
  tweets: TweetService;
  lifecycle: PostLifecycle;
  media: MediaService;
  r2: R2Client | null;
  logError: (error: unknown) => void;
}

function createRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .basePath('/api')
    .use('*', authMiddleware(deps.token))
    .route('/auth', authRoutes(deps))
    .route('/settings', settingsRoutes(deps))
    .route('/status', statusRoutes(deps))
    .route('/account', accountRoutes(deps))
    .route('/resources', resourcesRoutes(deps))
    .route('/posts', postsRoutes(deps))
    .route('/tags', tagsRoutes(deps))
    .route('/calendar', calendarRoutes(deps))
    .route('/counts', countsRoutes(deps))
    .route('/costs', costsRoutes(deps))
    .all('*', notFoundHandler);
}

export type AppType = ReturnType<typeof createRoutes>;

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route('/', createRoutes(deps));
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.route('/health', healthRoutes());
  app.get('/auth/x/callback', xCallbackHandler(deps));
  app.get('*', staticHandler(deps.webDist));
  return app;
}
