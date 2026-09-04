import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createTestServer, type TestServer } from '../src/testing';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => {
  server.cleanup();
});

describe('auth', () => {
  test('requires a valid bearer token', async () => {
    const missing = await server.app.request('/api/status');
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({
      code: 'unauthorized',
      message: 'Missing or invalid token',
    });

    const valid = await server.app.request('/api/status', {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(valid.status).toBe(200);

    const wrong = await server.app.request('/api/status', {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(wrong.status).toBe(401);
  });

  test('logs in and authenticates with the session cookie', async () => {
    const wrong = await server.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'wrong' }),
    });
    expect(wrong.status).toBe(401);

    const login = await server.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: server.token }),
    });
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ user: { id: 1 } });
    const cookie = login.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('perch_session=test-token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');

    const me = await server.app.request('/api/auth/me', {
      headers: { Cookie: `perch_session=${server.token}` },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user: { id: 1 } });

    const badCookie = await server.app.request('/api/auth/me', {
      headers: { Cookie: 'perch_session=wrong' },
    });
    expect(badCookie.status).toBe(401);
  });

  test('sets Secure when secure cookies are configured', async () => {
    const secureServer = await createTestServer({ secureCookies: true });
    try {
      const login = await secureServer.app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: secureServer.token }),
      });

      expect(login.status).toBe(200);
      expect(login.headers.get('set-cookie')).toContain('Secure');
    } finally {
      secureServer.cleanup();
    }
  });

  test('does not fall back to a cookie after a wrong bearer', async () => {
    const response = await server.app.request('/api/auth/me', {
      headers: {
        Authorization: 'Bearer wrong',
        Cookie: `perch_session=${server.token}`,
      },
    });
    expect(response.status).toBe(401);
  });

  test('logs out by clearing the session cookie', async () => {
    const response = await server.app.request('/api/auth/logout', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('perch_session=;');
    expect(cookie).toContain('Max-Age=0');
  });

  test('returns field validation errors for login', async () => {
    const response = await server.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      code: string;
      errors: Array<{ path: string }>;
    };
    expect(body.code).toBe('validation');
    expect(body.errors[0]?.path).toBe('token');
  });
});
