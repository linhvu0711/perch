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

async function connect(): Promise<Response> {
  const start = await request('/api/account/connect', { method: 'POST' });
  const { authorize_url } = await start.json();
  const state = new URL(authorize_url).searchParams.get('state')!;
  return server.app.request(`/auth/x/callback?code=abc&state=${state}`);
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
    expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3000/auth/x/callback');
    expect(url.searchParams.get('scope')).toBe(
      'tweet.read tweet.write users.read media.write offline.access',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')!.length).toBeGreaterThanOrEqual(32);
    expect(url.searchParams.get('code_challenge')!.length).toBeGreaterThanOrEqual(32);
    expect(server.xClient.calls).toEqual([]);
  });

  test('connects, stores the account, and logs the plan check', async () => {
    const start = await request('/api/account/connect', { method: 'POST' });
    const { authorize_url } = await start.json();
    const state = new URL(authorize_url).searchParams.get('state')!;

    const callback = await server.app.request(`/auth/x/callback?code=abc&state=${state}`);
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
    expect(await status.json()).toMatchObject({
      timezone: 'UTC',
      month_cost_usd: 0.01,
    });

    expect(server.xClient.calls.map((c) => c.name)).toEqual(['exchangeCode', 'getMe']);
    expect(server.xClient.calls[0]!.args[0]).toEqual({
      code: 'abc',
      codeVerifier: expect.stringMatching(/.{32,}/),
      redirectUri: 'http://127.0.0.1:3000/auth/x/callback',
    });
  });

  test('redirects callback failures and stores nothing', async () => {
    const unknown = await server.app.request('/auth/x/callback?code=abc&state=nope');
    expect(unknown.headers.get('Location')).toBe('/settings?connect_error=expired');

    const deniedStart = await request('/api/account/connect', {
      method: 'POST',
    });
    const state1 = new URL((await deniedStart.json()).authorize_url).searchParams.get('state')!;

    const denied = await server.app.request(`/auth/x/callback?error=access_denied&state=${state1}`);
    expect(denied.headers.get('Location')).toBe('/settings?connect_error=denied');

    const replayed = await server.app.request(`/auth/x/callback?code=abc&state=${state1}`);
    expect(replayed.headers.get('Location')).toBe('/settings?connect_error=expired');

    const failedStart = await request('/api/account/connect', {
      method: 'POST',
    });
    const state2 = new URL((await failedStart.json()).authorize_url).searchParams.get('state')!;
    server.xClient.exchangeError = new XError('http', 500, 'boom');
    const failed = await server.app.request(`/auth/x/callback?code=abc&state=${state2}`);
    expect(failed.headers.get('Location')).toBe('/settings?connect_error=failed');

    const account = await request('/api/account');
    expect(await account.json()).toEqual({
      account: null,
      char_limit: 280,
    });
    const status = await request('/api/status');
    expect((await status.json()).month_cost_usd).toBe(0);
  });

  test('disconnects another X user on connect and reuses the row of the same one', async () => {
    await connect();

    server.xClient.me = {
      id: '2000',
      username: 'second',
      name: 'Second',
      subscriptionType: 'Basic',
    };
    server.xClient.tokens = {
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      expiresIn: 7200,
      scope: 'tweet.read tweet.write users.read media.write offline.access',
    };
    server.clock.set(new Date('2026-09-04T11:00:00Z'));
    await connect();

    let res = await request('/api/account');
    let body = await res.json();
    expect(body.account.id).toBe(2);
    expect(body.account.username).toBe('second');
    expect(body.char_limit).toBe(280);

    const names = server.xClient.calls.map((c) => c.name);
    const afterSecondGetMe = names.slice(names.lastIndexOf('getMe') + 1);
    expect(afterSecondGetMe).toEqual(['revokeToken', 'revokeToken']);
    const revokeArgs = server.xClient.calls
      .filter((c) => c.name === 'revokeToken')
      .map((c) => c.args[0]);
    expect(revokeArgs).toEqual(['refresh-1', 'access-1']);

    server.xClient.me = {
      id: '1000',
      username: 'perchtester',
      name: 'Perch Tester',
      subscriptionType: 'Premium',
    };
    server.clock.set(new Date('2026-09-04T12:00:00Z'));
    await connect();

    res = await request('/api/account');
    body = await res.json();
    expect(body.account.id).toBe(1);
    expect(body.account.username).toBe('perchtester');
    expect(body.account.connected_at).toBe('2026-09-04T12:00:00.000Z');
    expect(body.char_limit).toBe(25000);

    const status = await request('/api/status');
    expect((await status.json()).month_cost_usd).toBe(0.03);
  });

  test('refreshes a due token on tick and persists the rotated one', async () => {
    await connect();

    await server.tick(new Date('2026-09-04T11:49:00Z'));
    expect(server.xClient.calls.filter((c) => c.name === 'refreshToken')).toHaveLength(0);

    await server.tick(new Date('2026-09-04T11:51:00Z'));
    let refreshes = server.xClient.calls.filter((c) => c.name === 'refreshToken');
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]!.args[0]).toBe('refresh-1');

    server.xClient.refreshed = {
      accessToken: 'access-3',
      refreshToken: 'refresh-3',
      expiresIn: 7200,
      scope: 'tweet.read tweet.write users.read media.write offline.access',
    };
    await server.tick(new Date('2026-09-04T13:51:00Z'));
    refreshes = server.xClient.calls.filter((c) => c.name === 'refreshToken');
    expect(refreshes).toHaveLength(2);
    expect(refreshes[1]!.args[0]).toBe('refresh-2');

    const res = await request('/api/account');
    expect((await res.json()).account.reconnect_required).toBe(false);
  });

  test('refreshes on demand before revoking', async () => {
    await connect();
    server.clock.set(new Date('2026-09-04T11:55:00Z'));

    const res = await request('/api/account/disconnect', {
      method: 'POST',
    });
    expect(res.status).toBe(200);

    const calls = server.xClient.calls;
    const afterGetMe = calls.slice(calls.map((c) => c.name).lastIndexOf('getMe') + 1);
    expect(afterGetMe.map((c) => c.name)).toEqual(['refreshToken', 'revokeToken', 'revokeToken']);
    expect(afterGetMe.map((c) => c.args[0])).toEqual(['refresh-1', 'refresh-2', 'access-2']);
  });

  test('marks an invalid grant as reconnect required and stops retrying', async () => {
    await connect();
    server.xClient.refreshError = new XError('invalid_grant', 400, 'expired');

    await server.tick(new Date('2026-09-04T11:51:00Z'));

    const res = await request('/api/account');
    const body = await res.json();
    expect(body.account.reconnect_required).toBe(true);
    expect(body.account.username).toBe('perchtester');

    await server.tick(new Date('2026-09-04T11:52:00Z'));
    expect(server.xClient.calls.filter((c) => c.name === 'refreshToken')).toHaveLength(1);

    server.xClient.refreshError = null;
    await connect();

    const reconnected = await request('/api/account');
    const reconnectedBody = await reconnected.json();
    expect(reconnectedBody.account.reconnect_required).toBe(false);
    expect(reconnectedBody.account.id).toBe(1);
  });

  test('disconnect revokes at X and keeps the row', async () => {
    await connect();
    server.clock.set(new Date('2026-09-04T10:30:00Z'));

    const res = await request('/api/account/disconnect', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      account: null,
      char_limit: 280,
    });

    const account = await request('/api/account');
    expect(await account.json()).toEqual({
      account: null,
      char_limit: 280,
    });

    const revokeArgs = server.xClient.calls
      .filter((c) => c.name === 'revokeToken')
      .map((c) => c.args[0]);
    expect(revokeArgs).toEqual(['refresh-1', 'access-1']);

    const again = await request('/api/account/disconnect', {
      method: 'POST',
    });
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({
      code: 'not_found',
      message: 'No X account connected',
    });

    server.clock.set(new Date('2026-09-04T10:40:00Z'));
    await connect();

    const reconnected = await request('/api/account');
    const body = await reconnected.json();
    expect(body.account.id).toBe(1);
    expect(body.account.connected_at).toBe('2026-09-04T10:40:00.000Z');
  });

  test('disconnects a reconnect-required account using stored tokens', async () => {
    await connect();
    server.xClient.refreshError = new XError('invalid_grant', 400, 'expired');
    await server.tick(new Date('2026-09-04T11:51:00Z'));

    const res = await request('/api/account/disconnect', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ account: null, char_limit: 280 });

    const calls = server.xClient.calls;
    const afterGetMe = calls.slice(calls.map((c) => c.name).lastIndexOf('getMe') + 1);
    expect(afterGetMe.map((c) => c.name)).toEqual(['refreshToken', 'revokeToken', 'revokeToken']);
    expect(afterGetMe.map((c) => c.args[0])).toEqual(['refresh-1', 'refresh-1', 'access-1']);
  });

  test('demand-path refresh failure surfaces reconnect_required', async () => {
    await connect();
    server.xClient.refreshError = new XError('invalid_grant', 400, 'expired');
    server.clock.set(new Date('2026-09-04T11:55:00Z'));

    const res = await request('/api/account/disconnect', {
      method: 'POST',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: 'reconnect_required',
      message: 'X account needs to be reconnected',
    });
    expect(server.xClient.calls.filter((c) => c.name === 'revokeToken')).toHaveLength(0);
  });

  test('disconnects when the token refresh fails', async () => {
    // Given: a connected account whose refresh endpoint is down, inside the refresh margin
    await connect();
    server.xClient.refreshError = new XError('http', 500, 'Internal Server Error');
    server.clock.set(new Date('2026-09-04T11:55:00Z'));

    // When
    const res = await request('/api/account/disconnect', { method: 'POST' });

    // Then
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ account: null, char_limit: 280 });
    expect(
      server.xClient.calls.filter((c) => c.name === 'revokeToken').map((c) => c.args[0]),
    ).toEqual(['refresh-1', 'access-1']);
  });

  test('coalesces concurrent refreshes into one call', async () => {
    await connect();
    server.clock.set(new Date('2026-09-04T11:55:00Z'));

    const [a, b] = await Promise.all([
      request('/api/account/disconnect', { method: 'POST' }),
      request('/api/account/disconnect', { method: 'POST' }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(server.xClient.calls.filter((c) => c.name === 'refreshToken')).toHaveLength(1);
  });

  test('override beats the plan limit', async () => {
    await connect();

    await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ char_limit_override: 500 }),
    });
    let res = await request('/api/account');
    expect((await res.json()).char_limit).toBe(500);

    await request('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ char_limit_override: null }),
    });
    res = await request('/api/account');
    expect((await res.json()).char_limit).toBe(25000);
  });

  test('returns 503 when X OAuth is not configured', async () => {
    server.cleanup();
    server = await createTestServer({ xOAuthConfigured: false });

    const res = await request('/api/account/connect', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      code: 'not_configured',
      message: 'X OAuth is not configured. Set PERCH_X_CLIENT_ID and PERCH_X_CLIENT_SECRET.',
    });
  });
});
