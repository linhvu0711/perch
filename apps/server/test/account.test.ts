import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createTestServer, type TestServer } from '../src/testing';
import { XError } from '../src/x/client';

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

  test('starts OAuth with PKCE and the five scopes', async () => {
    const res = await request('/api/account/connect', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    const url = new URL(body.authorize_url);
    expect(url.origin + url.pathname).toBe(
      'https://x.com/i/oauth2/authorize',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:3000/auth/x/callback',
    );
    expect(url.searchParams.get('scope')).toBe(
      'tweet.read tweet.write users.read media.write offline.access',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')!.length).toBeGreaterThanOrEqual(32);
    expect(
      url.searchParams.get('code_challenge')!.length,
    ).toBeGreaterThanOrEqual(32);
    expect(server.xClient.calls).toEqual([]);
  });

  test('connects, stores the account, and logs the plan check', async () => {
    const start = await request('/api/account/connect', { method: 'POST' });
    const { authorize_url } = await start.json();
    const state = new URL(authorize_url).searchParams.get('state')!;

    const callback = await server.app.request(
      `/auth/x/callback?code=abc&state=${state}`,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('Location')).toBe('/settings?connected=1');

    const account = await request('/api/account');
    expect(await account.json()).toEqual({
      account: {
        id: 1,
        x_user_id: '1000',
        username: 'perchtester',
        subscription_type: 'Premium',
        connected_at: '2026-09-04T10:00:00.000Z',
        reconnect_required: false,
      },
      char_limit: 25000,
    });

    const status = await request('/api/status');
    expect(await status.json()).toEqual({
      timezone: 'UTC',
      month_cost_usd: 0.01,
    });

    expect(server.xClient.calls.map((c) => c.name)).toEqual([
      'exchangeCode',
      'getMe',
    ]);
    expect(server.xClient.calls[0]!.args[0]).toEqual({
      code: 'abc',
      codeVerifier: expect.stringMatching(/.{32,}/),
      redirectUri: 'http://127.0.0.1:3000/auth/x/callback',
    });
  });

  test('redirects callback failures and stores nothing', async () => {
    const unknown = await server.app.request(
      '/auth/x/callback?code=abc&state=nope',
    );
    expect(unknown.headers.get('Location')).toBe(
      '/settings?connect_error=expired',
    );

    const deniedStart = await request('/api/account/connect', {
      method: 'POST',
    });
    const state1 = new URL((await deniedStart.json()).authorize_url)
      .searchParams.get('state')!;

    const denied = await server.app.request(
      `/auth/x/callback?error=access_denied&state=${state1}`,
    );
    expect(denied.headers.get('Location')).toBe(
      '/settings?connect_error=denied',
    );

    const replayed = await server.app.request(
      `/auth/x/callback?code=abc&state=${state1}`,
    );
    expect(replayed.headers.get('Location')).toBe(
      '/settings?connect_error=expired',
    );

    const failedStart = await request('/api/account/connect', {
      method: 'POST',
    });
    const state2 = new URL((await failedStart.json()).authorize_url)
      .searchParams.get('state')!;
    server.xClient.exchangeError = new XError('http', 500, 'boom');
    const failed = await server.app.request(
      `/auth/x/callback?code=abc&state=${state2}`,
    );
    expect(failed.headers.get('Location')).toBe(
      '/settings?connect_error=failed',
    );

    const account = await request('/api/account');
    expect(await account.json()).toEqual({
      account: null,
      char_limit: 280,
    });
    const status = await request('/api/status');
    expect((await status.json()).month_cost_usd).toBe(0);
  });

  test('returns 503 when X OAuth is not configured', async () => {
    server.cleanup();
    server = await createTestServer({ xOAuthConfigured: false });

    const res = await request('/api/account/connect', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      code: 'not_configured',
      message:
        'X OAuth is not configured. Set PERCH_X_CLIENT_ID and PERCH_X_CLIENT_SECRET.',
    });
  });
});
