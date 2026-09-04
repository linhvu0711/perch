import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fixedClock } from './clock';
import { buildServer, type PerchServer } from './server';
import { fakeXClient, type FakeXClient } from './x/client';

export interface TestServer extends PerchServer {
  token: string;
  clock: ReturnType<typeof fixedClock>;
  xClient: FakeXClient;
  dir: string;
  webDist: string;
  cleanup(): void;
}

export async function createTestServer(opts?: {
  indexHtml?: string;
  now?: Date;
}): Promise<TestServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perch-test-'));
  const dbPath = path.join(dir, 'perch.db');
  const uploadDir = path.join(dir, 'uploads');
  const webDist = path.join(dir, 'web');
  fs.mkdirSync(webDist, { recursive: true });
  fs.writeFileSync(
    path.join(webDist, 'index.html'),
    opts?.indexHtml ?? '<!doctype html><div id="root">perch-test-app</div>',
  );

  const clock = fixedClock(
    opts?.now ?? new Date('2026-09-04T10:00:00Z'),
  );
  const xClient = fakeXClient();
  const token = 'test-token';
  const server = await buildServer({
    dbPath,
    uploadDir,
    clock,
    xClient,
    token,
    webDist,
  });

  return {
    ...server,
    token,
    clock,
    xClient,
    dir,
    webDist,
    cleanup() {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
