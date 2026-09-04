import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createTestServer, type TestServer } from '../src/testing';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

function request(path: string, init: RequestInit = {}): Promise<Response> {
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
