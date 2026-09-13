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
  for (const createdAt of [
    '2026-08-10T10:00:00Z',
    '2026-09-01T10:00:00Z',
    '2026-09-02T10:00:00Z',
  ]) {
    insertTestApiCall(server, {
      endpoint: 'POST /2/tweets',
      costUsd: 0.015,
      createdAt,
    });
  }
  insertTestApiCall(server, {
    endpoint: 'GET /2/tweets/:id',
    costUsd: 0.015,
    createdAt: '2026-09-02T11:00:00Z',
  });
  insertTestApiCall(server, {
    endpoint: 'GET /2/users/me',
    costUsd: 0.01,
    createdAt: '2026-08-10T11:00:00Z',
  });
}

describe('cost', () => {
  test('prints the month table with newest first and the all-time line last', async () => {
    // Given: calls across August and September
    seedCalls();
    const tty = makeCtx(server, { isTTY: true });

    // When
    expect(await runCli(['cost'], tty.ctx)).toBe(0);

    // Then
    const out = tty.out();
    expect(out).toMatch(/^month\s+calls\s+publish\s+save_tweet\s+connect\s+total/m);
    expect(out.indexOf('2026-09')).toBeLessThan(out.indexOf('2026-08'));
    expect(out).toMatch(/2026-09\s+3\s+\$0\.030\s+\$0\.015\s+\$0\.000\s+\$0\.045/);
    expect(out).toMatch(/2026-08\s+2\s+\$0\.015\s+\$0\.000\s+\$0\.010\s+\$0\.025/);
    expect(out.trimEnd().endsWith('all time $0.070')).toBe(true);
  });

  test('perch cost --month shows only that month plus the all-time line', async () => {
    // Given: calls across August and September
    seedCalls();
    const tty = makeCtx(server, { isTTY: true });

    // When
    expect(await runCli(['cost', '--month', '2026-08'], tty.ctx)).toBe(0);

    // Then
    const out = tty.out();
    expect(out).toContain('2026-08');
    expect(out).not.toContain('2026-09');
    expect(out.trimEnd().endsWith('all time $0.070')).toBe(true);
  });

  test('perch cost --json prints the JSON body', async () => {
    // Given: calls across August and September
    seedCalls();
    const json = makeCtx(server);

    // When
    expect(await runCli(['cost', '--month', '2026-09', '--json'], json.ctx)).toBe(0);

    // Then
    expect(JSON.parse(json.out())).toEqual({
      month: '2026-09',
      calls: 3,
      publish_usd: 0.03,
      save_tweet_usd: 0.015,
      connect_usd: 0,
      total_usd: 0.045,
      all_time_usd: 0.07,
    });
  });

  test('perch cost --months limits the history rows', async () => {
    // Given: calls across August and September
    seedCalls();
    const tty = makeCtx(server, { isTTY: true });

    // When
    expect(await runCli(['cost', '--months', '1'], tty.ctx)).toBe(0);

    // Then
    const out = tty.out();
    expect(out).toContain('2026-09');
    expect(out).not.toContain('2026-08');
  });

  test('perch cost with no calls still prints an empty table', async () => {
    // Given: no calls
    const tty = makeCtx(server, { isTTY: true });

    // When
    expect(await runCli(['cost'], tty.ctx)).toBe(0);

    // Then
    expect(tty.out()).toContain('all time $0.000');
  });
});
