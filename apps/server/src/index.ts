import fs from 'node:fs';
import path from 'node:path';

import { systemClock } from './clock';
import { buildServer } from './server';
import { createRealXClient } from './x/real';

export { buildServer } from './server';
export type { AppType } from './app';
export type { BuildServerOptions, PerchServer } from './server';

if (import.meta.main) {
  const token = process.env.PERCH_TOKEN;
  if (!token) {
    console.error('PERCH_TOKEN is required');
    process.exit(1);
  }

  const secureCookiesValue = (
    process.env.PERCH_SECURE_COOKIES || 'true'
  ).toLowerCase();
  if (secureCookiesValue !== 'true' && secureCookiesValue !== 'false') {
    console.error('PERCH_SECURE_COOKIES must be true or false');
    process.exit(1);
  }

  const dbPath = path.resolve(
    process.env.PERCH_DB_PATH || './data/perch.db',
  );
  const uploadDir = path.resolve(
    process.env.PERCH_UPLOAD_DIR || './data/uploads',
  );
  const webDist = path.resolve(
    process.env.PERCH_WEB_DIST ||
      path.resolve(import.meta.dir, '../../web/dist'),
  );
  const port = Number(process.env.PORT || '3000');

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const perch = await buildServer({
    dbPath,
    uploadDir,
    clock: systemClock,
    xClient: createRealXClient({ clientId: '', clientSecret: '' }),
    token,
    secureCookies: secureCookiesValue === 'true',
    webDist,
  });

  const intervalId = setInterval(
    () => perch.tick(systemClock.now()).catch(console.error),
    30_000,
  );
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
}
