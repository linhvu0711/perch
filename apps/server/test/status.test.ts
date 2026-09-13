import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createTestServer, type TestServer } from '../src/testing';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${server.token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return server.app.request(path, { ...init, headers });
}

describe('status', () => {
  test('reflects the configured time zone', async () => {
    const initial = await request('/api/status');
    expect(await initial.json()).toEqual({
      timezone: 'UTC',
      month_cost_usd: 0,
    });

    await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'Europe/Berlin' }),
    });

    const updated = await request('/api/status');
    expect(await updated.json()).toEqual({
      timezone: 'Europe/Berlin',
      month_cost_usd: 0,
    });
  });

  test('exposes a resolving scheduler tick', async () => {
    await expect(server.tick(server.clock.now())).resolves.toBeUndefined();
  });
});
