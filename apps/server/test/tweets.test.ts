import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createTestServer, type TestServer } from '../src/testing';

let server: TestServer;

beforeEach(async () => {
  server = await createTestServer();
});

afterEach(() => server.cleanup());

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${server.token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return server.app.request(path, { ...init, headers });
}

async function connect(): Promise<void> {
  const start = await request('/api/account/connect', { method: 'POST' });
  const state = new URL((await start.json()).authorize_url).searchParams.get('state');
  await server.app.request(`/auth/x/callback?code=abc&state=${state}`);
}

describe('tweet resources', () => {
  test('requires an account and saves a tweet', async () => {
    const missing = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://x.com/a/status/1'] }),
    });
    expect(missing.status).toBe(404);

    await connect();
    const response = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://x.com/a/status/1'] }),
    });
    const body = await response.json();
    expect(body.results[0].status).toBe('created');
    expect(body.results[0].resource.text).toContain('smallest thing');
    expect(server.xClient.calls.filter((call) => call.name === 'getTweet')).toHaveLength(1);
  });

  test('deduplicates aliases and reports rejection reasons', async () => {
    await connect();
    const first = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://x.com/a/status/1'] }),
    });
    expect((await first.json()).results[0].status).toBe('created');
    const calls = server.xClient.calls.length;
    const duplicate = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['https://twitter.com/i/web/status/1', 'not-a-url', 'https://x.com/a/status/2'],
      }),
    });
    const results = (await duplicate.json()).results;
    expect(results[0].status).toBe('existing');
    expect(results[1].error.code).toBe('invalid_url');
    expect(results[2].error.code).toBe('has_media');
    expect(server.xClient.calls.length).toBe(calls + 1);
  });

  test('stores note tweets in full and refreshes text', async () => {
    await connect();
    const response = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://x.com/a/status/3'] }),
    });
    const created = (await response.json()).results[0].resource;
    expect(created.text).toBe('A long-form post. '.repeat(20));
    const noteTweet = server.xClient.tweets['3'];
    if (!noteTweet) throw new Error('missing fake note tweet');
    noteTweet.noteText = 'updated';
    const refreshed = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://x.com/a/status/3'], refresh: true }),
    });
    expect((await refreshed.json()).results[0].status).toBe('refreshed');
    expect((await request(`/api/resources/${created.id}`)).json()).resolves.toMatchObject({
      text: 'updated',
    });
  });
});
