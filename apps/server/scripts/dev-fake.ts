import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';

import { systemClock } from '../src/clock';
import { buildServer } from '../src/server';
import { XError } from '../src/x/client';
import { fakeXClient } from '../src/x/fake';

const token = process.env.PERCH_TOKEN;
if (!token) {
  console.error('PERCH_TOKEN is required');
  process.exit(1);
}
const port = Number(process.env.PORT || '3000');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perch-fake-'));
const webDist = path.resolve(import.meta.dir, '../../web/dist');

const xClient = fakeXClient();
if (process.argv.includes('--invalid-grant')) {
  xClient.tokens.expiresIn = 0;
  xClient.refreshError = new XError('invalid_grant', 400, 'expired');
}

const perch = await buildServer({
  dbPath: path.join(dir, 'perch.db'),
  uploadDir: path.join(dir, 'uploads'),
  clock: systemClock,
  xClient,
  token,
  secureCookies: false,
  webDist,
  xOAuth: {
    clientId: 'fake',
    redirectUri: `http://127.0.0.1:${port}/auth/x/callback`,
    authorizeUrl: `http://127.0.0.1:${port}/auth/x/fake-authorize`,
  },
});

const app = new Hono();
app.get('/auth/x/fake-authorize', (c) =>
  c.redirect(`/auth/x/callback?code=fake-code&state=${c.req.query('state')}`),
);
app.route('/', perch.app);

const intervalId = setInterval(
  () => perch.tick(systemClock.now()).catch(console.error),
  30_000,
);
const server = Bun.serve({ port, fetch: app.fetch });

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

console.log(`perch dev-fake server on http://127.0.0.1:${port}`);
