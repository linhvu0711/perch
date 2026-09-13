import fs from 'node:fs';
import path from 'node:path';

import { systemClock } from './clock';
import { parseServerEnv } from './env';
import { buildServer } from './server';
import { createRealXClient } from './x/real';

export type { AppType } from './app';
export type { BuildServerOptions, PerchServer } from './server';
export { buildServer } from './server';

if (import.meta.main) {
  const parsed = parseServerEnv(process.env);
  if (!parsed.ok) {
    console.error(parsed.message);
    process.exit(1);
  }
  const env = parsed.env;

  const dbPath = path.resolve(env.PERCH_DB_PATH);
  const uploadDir = path.resolve(env.PERCH_UPLOAD_DIR);
  const webDist = path.resolve(
    env.PERCH_WEB_DIST ?? path.resolve(import.meta.dir, '../../web/dist'),
  );
  const port = env.PORT;

  const xClientId = env.PERCH_X_CLIENT_ID;
  const xClientSecret = env.PERCH_X_CLIENT_SECRET;
  const publicUrl = (env.PERCH_PUBLIC_URL ?? `http://127.0.0.1:${port}`).replace(/\/$/, '');
  const xOAuth =
    xClientId && xClientSecret
      ? {
          clientId: xClientId,
          redirectUri: `${publicUrl}/auth/x/callback`,
          authorizeUrl: 'https://x.com/i/oauth2/authorize',
        }
      : null;
  if (!xOAuth) {
    console.warn('X OAuth is not configured; Connect X is disabled');
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const perch = await buildServer({
    dbPath,
    uploadDir,
    clock: systemClock,
    xClient: createRealXClient({
      clientId: xClientId ?? '',
      clientSecret: xClientSecret ?? '',
    }),
    xOAuth,
    token: env.PERCH_TOKEN,
    secureCookies: env.PERCH_SECURE_COOKIES,
    webDist,
  });

  const intervalId = setInterval(() => perch.tick(systemClock.now()).catch(console.error), 30_000);
  const server = Bun.serve({ port, fetch: perch.app.fetch });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(intervalId);
    server.stop();
    perch.close();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  console.log(`perch server on http://localhost:${port}`);
  console.log(`public url ${publicUrl}`);
}
