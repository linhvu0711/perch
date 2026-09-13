import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createTestServer, type TestServer } from '@perch/server/testing';

import { runCli } from '../src/cli';
import { makeCtx } from './helpers';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

async function connect(): Promise<void> {
  const start = await server.app.request('/api/account/connect', {
    method: 'POST',
    headers: { Authorization: `Bearer ${server.token}` },
  });
  const { authorize_url } = await start.json();
  const state = new URL(authorize_url).searchParams.get('state')!;
  await server.app.request(`/auth/x/callback?code=abc&state=${state}`);
}

describe('account commands', () => {
  test('shows no account, then the connected account', async () => {
    const { ctx, out } = makeCtx(server);

    expect(await runCli(['account', 'show', '--json'], ctx)).toBe(0);
    expect(JSON.parse(out())).toEqual({
      connected: false,
      char_limit: 280,
    });

    await connect();

    const before = out().length;
    expect(await runCli(['account', 'show', '--json'], ctx)).toBe(0);
    expect(JSON.parse(out().slice(before))).toEqual({
      connected: true,
      username: 'perchtester',
      x_user_id: '1000',
      subscription_type: 'Premium',
      char_limit: 25000,
      connected_at: '2026-09-04T10:00:00.000Z',
      reconnect_required: false,
    });
  });

  test('refuses to disconnect without --yes outside a TTY', async () => {
    await connect();
    const { ctx, err } = makeCtx(server);

    expect(await runCli(['account', 'disconnect', '--json'], ctx)).toBe(1);
    expect(JSON.parse(err())).toEqual({
      code: 'confirm_required',
      message: 'Refusing to disconnect without --yes',
    });
    expect(server.xClient.calls.filter((c) => c.name === 'revokeToken')).toHaveLength(0);
  });

  test('disconnects with --yes', async () => {
    await connect();
    const { ctx, out } = makeCtx(server);

    expect(await runCli(['account', 'disconnect', '--yes', '--json'], ctx)).toBe(0);
    expect(out()).toBe('{\n  "disconnected": true\n}\n');

    const before = out().length;
    expect(await runCli(['account', 'show', '--json'], ctx)).toBe(0);
    expect(JSON.parse(out().slice(before))).toEqual({
      connected: false,
      char_limit: 280,
    });
  });
});
