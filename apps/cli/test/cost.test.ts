import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TestServer } from '@perch/server/testing';
import { createTestServer, insertTestApiCall } from '@perch/server/testing';

import { runCli } from '../src/cli';
import { makeCtx } from './helpers';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

function seedCalls(): void {
  insertTestApiCall(server, {
    endpoint: 'POST /2/tweets',
    costUsd: 0.015,
    createdAt: '2026-09-02T09:00:00Z',
  });
  insertTestApiCall(server, {
    endpoint: 'GET /2/tweets/:id',
    costUsd: 0.015,
    createdAt: '2026-09-03T09:00:00Z',
  });
  insertTestApiCall(server, {
    endpoint: 'GET /2/users/me',
    costUsd: 0.01,
    createdAt: '2026-08-20T09:00:00Z',
  });
}

describe('cost', () => {
  test('prints this month split by kind', async () => {
    // Given: calls in September and August
    seedCalls();

    // When
    const json = makeCtx(server);
    expect(await runCli(['cost', '--json'], json.ctx)).toBe(0);
    const tty = makeCtx(server, { isTTY: true });
    expect(await runCli(['cost'], tty.ctx)).toBe(0);

    // Then
    expect(JSON.parse(json.out())).toEqual({
      month: '2026-09',
      calls: 2,
      publish_usd: 0.015,
      save_tweet_usd: 0.015,
      connect_usd: 0,
      total_usd: 0.03,
      all_time_usd: 0.04,
    });
    expect(tty.out()).toMatch(/^month\s+2026-09$/m);
    expect(tty.out()).toMatch(/^publish\s+\$0\.015$/m);
    expect(tty.out()).toMatch(/^total\s+\$0\.030$/m);
    expect(tty.out()).toMatch(/^all_time\s+\$0\.040$/m);
  });

  test('--month picks a month and rejects a bad one', async () => {
    // Given: calls in September and August
    seedCalls();

    // When
    const json = makeCtx(server);
    expect(await runCli(['cost', '--month', '2026-08', '--json'], json.ctx)).toBe(0);
    const bad = makeCtx(server);
    expect(await runCli(['cost', '--month', '2026-8', '--json'], bad.ctx)).toBe(2);

    // Then
    const body = JSON.parse(json.out());
    expect(body.month).toBe('2026-08');
    expect(body.connect_usd).toBe(0.01);
    expect(body.total_usd).toBe(0.01);
    expect(body.all_time_usd).toBe(0.04);
    expect(bad.out()).toBe('');
    expect(JSON.parse(bad.err())).toEqual({
      code: 'usage',
      message: '--month must be YYYY-MM',
    });
  });
});
