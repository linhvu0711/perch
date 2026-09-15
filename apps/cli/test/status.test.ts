import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { TestServer } from '@perch/server/testing';
import { connectTestAccount, createTestServer } from '@perch/server/testing';

import { runCli } from '../src/cli';
import { makeCtx } from './helpers';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

describe('status', () => {
  test('prints the picture in JSON and on one screen', async () => {
    // Given: a connected account, a future draft, and a missed draft
    connectTestAccount(server);
    const setup = makeCtx(server);
    await runCli(['post', 'create', '--text', 'Soon', '--json'], setup.ctx);
    await runCli(['post', 'schedule', '1', '--at', '2026-09-06T09:00:00Z'], setup.ctx);
    await runCli(['post', 'create', '--text', 'Old', '--json'], setup.ctx);
    await runCli(['post', 'schedule', '2', '--at', '2026-09-02T09:00:00Z', '--force'], setup.ctx);

    // When
    const json = makeCtx(server);
    expect(await runCli(['status', '--json'], json.ctx)).toBe(0);
    const tty = makeCtx(server, { isTTY: true });
    expect(await runCli(['status'], tty.ctx)).toBe(0);

    // Then
    const body = JSON.parse(json.out());
    expect(body).toMatchObject({
      account: { username: 'perchtester' },
      missed_count: 1,
      failed_count: 0,
      month_cost_usd: 0,
      last_pull_at: null,
    });
    expect(body.next_due.map((post: { id: number }) => post.id)).toEqual([1]);
    expect(typeof body.mirror_dir).toBe('string');
    expect(tty.out()).toMatch(/^account\s+@perchtester$/m);
    expect(tty.out()).toMatch(/^missed\s+1$/m);
    expect(tty.out()).toMatch(/^month_cost\s+\$0\.000$/m);
    expect(tty.out()).toMatch(/^mirror_dir\s+/m);
    expect(tty.out()).toContain('Soon');
  });
});
