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

describe('account', () => {
  test('returns the default account status and requires authentication', async () => {
    const res = await request('/api/account');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ account: null, char_limit: 280 });

    const unauthenticated = await server.app.request('/api/account');
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({
      code: 'unauthorized',
      message: 'Missing or invalid token',
    });
  });
});
