import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { buildServer } from '../src/server';
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

describe('settings', () => {
  test('returns default settings', async () => {
    const response = await request('/api/settings');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      timezone: 'UTC',
      char_limit_override: null,
    });
  });

  test('round-trips time zone and character limit changes', async () => {
    const timezone = await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'Asia/Ho_Chi_Minh' }),
    });
    expect(await timezone.json()).toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      char_limit_override: null,
    });

    const limit = await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ char_limit_override: 280 }),
    });
    expect(await limit.json()).toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      char_limit_override: 280,
    });

    const cleared = await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ char_limit_override: null }),
    });
    expect(await cleared.json()).toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      char_limit_override: null,
    });

    const persisted = await request('/api/settings');
    expect(await persisted.json()).toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      char_limit_override: null,
    });
  });

  test('seeds the time zone from the boot option', async () => {
    // Given: a server booted with timezone Europe/Berlin
    server.cleanup();
    server = await createTestServer({ timezone: 'Europe/Berlin' });

    // When: GET /api/settings
    const response = await request('/api/settings');

    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      timezone: 'Europe/Berlin',
      char_limit_override: null,
    });
  });

  test('keeps the stored time zone on a later boot', async () => {
    // Given: a server whose time zone was changed, then a second boot on the same database
    await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'Asia/Ho_Chi_Minh' }),
    });
    server.close();
    const second = await buildServer({
      dbPath: path.join(server.dir, 'perch.db'),
      uploadDir: path.join(server.dir, 'uploads'),
      clock: server.clock,
      xClient: server.xClient,
      token: server.token,
      secureCookies: false,
      webDist: server.webDist,
      timezone: 'Europe/Berlin',
      r2: null,
      logError: () => {},
    });
    try {
      // When: GET /api/settings on the second app
      const response = await second.app.request('/api/settings', {
        headers: { Authorization: `Bearer ${server.token}` },
      });
      // Then: the stored value wins over the boot option
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        timezone: 'Asia/Ho_Chi_Minh',
        char_limit_override: null,
      });
    } finally {
      second.close();
    }
  });

  test('reports validation errors', async () => {
    const badTimezone = await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'Nope/Nope' }),
    });
    expect(badTimezone.status).toBe(400);
    const timezoneBody = (await badTimezone.json()) as {
      errors: Array<{ path: string }>;
    };
    expect(timezoneBody.errors[0]?.path).toBe('timezone');

    const empty = await request('/api/settings', {
      method: 'PATCH',
      body: '{}',
    });
    expect(empty.status).toBe(400);

    const tooLarge = await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ char_limit_override: 25_001 }),
    });
    expect(tooLarge.status).toBe(400);
  });
});
