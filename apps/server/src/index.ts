import fs from 'node:fs';
import path from 'node:path';

import { systemClock } from './clock';
import { buildServer } from './server';

export { buildServer } from './server';
export type { AppType } from './app';
export type { BuildServerOptions, PerchServer } from './server';

if (import.meta.main) {
  const token = process.env.PERCH_TOKEN;
  if (!token) {
    console.error('PERCH_TOKEN is required');
    process.exit(1);
  }

  const dbPath = process.env.PERCH_DB_PATH ?? './data/perch.db';
  const uploadDir = process.env.PERCH_UPLOAD_DIR ?? './data/uploads';
  const webDist =
    process.env.PERCH_WEB_DIST ??
    path.resolve(import.meta.dir, '../../web/dist');
  const port = Number(process.env.PORT ?? '3000');

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const server = await buildServer({
    dbPath,
    uploadDir,
    clock: systemClock,
    xClient: {},
    token,
    webDist,
  });

  setInterval(
    () => server.tick(systemClock.now()).catch(console.error),
    30_000,
  );
  Bun.serve({ port, fetch: server.app.fetch });
  console.log(`perch server on http://localhost:${port}`);
}
