import fs from 'node:fs';
import path from 'node:path';

import type { Hono } from 'hono';

import { createApp, type AppEnv } from './app';
import type { Clock } from './clock';
import { migrateDb, openDb, seedDb } from './db';
import { createTick } from './scheduler';
import type { XClient } from './x/client';

export interface BuildServerOptions {
  dbPath: string;
  uploadDir: string;
  clock: Clock;
  xClient: XClient;
  token: string;
  secureCookies: boolean;
  webDist: string;
}

export interface PerchServer {
  app: Hono<AppEnv>;
  tick: (now: Date) => Promise<void>;
  close: () => void;
}

export async function buildServer(
  options: BuildServerOptions,
): Promise<PerchServer> {
  fs.mkdirSync(options.uploadDir, { recursive: true });
  const { db, sqlite } = openDb(options.dbPath);
  migrateDb(db);
  seedDb(db, options.clock.now());
  const webDist = path.resolve(options.webDist);
  const app = createApp({
    db,
    token: options.token,
    secureCookies: options.secureCookies,
    webDist,
    clock: options.clock,
  });
  const tick = createTick({
    db,
    clock: options.clock,
    xClient: options.xClient,
  });

  return {
    app,
    tick,
    close: () => sqlite.close(),
  };
}
