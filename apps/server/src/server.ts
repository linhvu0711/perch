import fs from 'node:fs';
import path from 'node:path';

import type { Hono } from 'hono';

import { type AppEnv, createApp } from './app';
import type { Clock } from './clock';
import { migrateDb, openDb, seedDb } from './db';
import { createPostLifecycle } from './postLifecycle';
import type { R2Client } from './r2/client';
import { createTick } from './scheduler';
import { createXAccountService } from './x/accounts';
import type { XClient } from './x/client';
import type { XOAuthConfig } from './x/oauth';
import { createTweetService } from './x/tweets';

export interface BuildServerOptions {
  dbPath: string;
  uploadDir: string;
  clock: Clock;
  xClient: XClient;
  xOAuth?: XOAuthConfig | null;
  token: string;
  secureCookies: boolean;
  webDist: string;
  timezone: string;
  r2: R2Client | null;
  logError: (error: unknown) => void;
}

export interface PerchServer {
  app: Hono<AppEnv>;
  tick: (now: Date) => Promise<void>;
  close: () => void;
}

export async function buildServer(options: BuildServerOptions): Promise<PerchServer> {
  fs.mkdirSync(options.uploadDir, { recursive: true });
  const { db, sqlite } = openDb(options.dbPath);
  migrateDb(db);
  seedDb(db, options.clock.now(), options.timezone);
  const webDist = path.resolve(options.webDist);
  const accounts = createXAccountService({
    db,
    clock: options.clock,
    xClient: options.xClient,
    xOAuth: options.xOAuth ?? null,
  });
  const tweets = createTweetService({
    db,
    clock: options.clock,
    accounts,
    xClient: options.xClient,
  });
  const lifecycle = createPostLifecycle({
    db,
    clock: options.clock,
    accounts,
    xClient: options.xClient,
    uploadDir: options.uploadDir,
  });
  const app = createApp({
    db,
    token: options.token,
    secureCookies: options.secureCookies,
    webDist,
    uploadDir: options.uploadDir,
    clock: options.clock,
    accounts,
    tweets,
    lifecycle,
    r2: options.r2,
    logError: options.logError,
  });
  const tick = createTick({ accounts, lifecycle });

  return {
    app,
    tick,
    close: () => sqlite.close(),
  };
}
