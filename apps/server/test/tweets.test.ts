import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createTestServer, type TestServer } from '../src/testing';
import { XError } from '../src/x/client';

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
  const { authorize_url } = (await start.json()) as { authorize_url: string };
  const state = new URL(authorize_url).searchParams.get('state');
  await server.app.request(`/auth/x/callback?code=abc&state=${state}`);
}

async function list(query = ''): Promise<{ items: Array<{ id: number }>; total: number }> {
  const response = await request(`/api/resources${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as { items: Array<{ id: number }>; total: number };
}

describe('tweet resources', () => {
  test('saves a text tweet, logs the cost, and lists it', async () => {
    // Given: a connected X account and the fake client's default tweet
    await connect();

    // When
    const response = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://x.com/perchtester/status/1'] }),
    });

    // Then
    expect(response.status).toBe(200);
    const resource = {
      id: 1,
      type: 'tweet',
      title: 'hello',
      notes: '',
      created_at: '2026-09-04T10:00:00.000Z',
      url: 'https://x.com/perchtester/status/1',
      x_id: '1',
      author_id: '1000',
      author_username: 'perchtester',
      text: 'hello',
      posted_at: '2026-09-01T12:00:00.000Z',
      tags: [],
    };
    expect(await response.json()).toEqual({
      results: [
        {
          url: 'https://x.com/perchtester/status/1',
          ok: true,
          status: 'created',
          resource,
        },
      ],
    });
    expect(await (await request('/api/resources/1')).json()).toEqual(resource);
    expect((await list()).total).toBe(1);
    const status = (await (await request('/api/status')).json()) as {
      month_cost_usd: number;
    };
    expect(status.month_cost_usd).toBe(0.025);
    const calls = server.xClient.calls;
    expect(calls.map((call) => call.name).at(-1)).toBe('getTweet');
    expect(calls.at(-1)?.args).toEqual(['access-1', '1']);
  });

  test('requires a connected X account', async () => {
    // Given: no connected account
    // When
    const response = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://x.com/perchtester/status/1'] }),
    });

    // Then
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: 'not_found',
      message: 'No X account connected',
    });
    expect(server.xClient.calls).toEqual([]);
    const status = (await (await request('/api/status')).json()) as {
      month_cost_usd: number;
    };
    expect(status.month_cost_usd).toBe(0);
  });

  test('rejects each of the five reasons with the reason named', async () => {
    // Given: tweets carrying each rejection signal
    await connect();
    server.xClient.tweets = {
      '2': { ...server.xClient.tweet, id: '2', hasMedia: true },
      '3': { ...server.xClient.tweet, id: '3', isArticle: true },
      '4': {
        ...server.xClient.tweet,
        id: '4',
        referencedTweets: [{ type: 'retweeted', id: '9' }],
      },
      '5': {
        ...server.xClient.tweet,
        id: '5',
        referencedTweets: [{ type: 'replied_to', id: '9' }],
      },
      '6': {
        ...server.xClient.tweet,
        id: '6',
        referencedTweets: [{ type: 'quoted', id: '9' }],
      },
    };

    // When
    const response = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({
        urls: [2, 3, 4, 5, 6].map((id) => `https://x.com/perchtester/status/${id}`),
      }),
    });

    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        {
          url: 'https://x.com/perchtester/status/2',
          ok: false,
          error: { code: 'has_media', message: 'Post has media' },
        },
        {
          url: 'https://x.com/perchtester/status/3',
          ok: false,
          error: { code: 'is_article', message: 'Post is an article' },
        },
        {
          url: 'https://x.com/perchtester/status/4',
          ok: false,
          error: { code: 'is_retweet', message: 'Post is a retweet' },
        },
        {
          url: 'https://x.com/perchtester/status/5',
          ok: false,
          error: { code: 'is_reply', message: 'Post is a reply' },
        },
        {
          url: 'https://x.com/perchtester/status/6',
          ok: false,
          error: { code: 'is_quote', message: 'Post is a quote' },
        },
      ],
    });
    expect((await list()).total).toBe(0);
    const status = (await (await request('/api/status')).json()) as {
      month_cost_usd: number;
    };
    expect(status.month_cost_usd).toBe(0.085);
  });

  test('stores a note tweet in full', async () => {
    // Given: a tweet whose note_tweet carries the full text
    await connect();
    server.xClient.tweets['7'] = {
      ...server.xClient.tweet,
      id: '7',
      text: 'long form…',
      noteText: 'long form text in full',
    };

    // When
    const response = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://x.com/perchtester/status/7'] }),
    });

    // Then
    const { results } = (await response.json()) as {
      results: Array<{ resource: { text: string; title: string } }>;
    };
    expect(results[0]?.resource.text).toBe('long form text in full');
    expect(results[0]?.resource.title).toBe('long form text in full');
  });

  test('reports bad URLs and X failures per item', async () => {
    // Given: the fake client failing every fetch
    await connect();
    server.xClient.tweetError = new XError('http', 404, 'not found');

    // When
    const response = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({ urls: ['not a url', 'https://x.com/a/status/8'] }),
    });

    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [
        {
          url: 'not a url',
          ok: false,
          error: { code: 'invalid_url', message: 'Not a tweet URL' },
        },
        {
          url: 'https://x.com/a/status/8',
          ok: false,
          error: { code: 'not_found', message: 'Tweet not found or not readable' },
        },
      ],
    });
    const status = (await (await request('/api/status')).json()) as {
      month_cost_usd: number;
    };
    expect(status.month_cost_usd).toBe(0.01);

    const noUrls = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(noUrls.status).toBe(400);
    expect(await noUrls.json()).toMatchObject({ errors: [{ path: 'urls' }] });

    const tooMany = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({ urls: Array.from({ length: 101 }, (_, i) => `u${i}`) }),
    });
    expect(tooMany.status).toBe(400);
  });

  test('returns the existing resource for a duplicate URL with no X call', async () => {
    // Given: one saved tweet
    await connect();
    await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://x.com/perchtester/status/1'] }),
    });

    // When
    const response = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['https://twitter.com/whoever/status/1?s=20', 'https://x.com/i/web/status/1'],
      }),
    });

    // Then
    expect(await response.json()).toMatchObject({
      results: [
        { ok: true, status: 'existing', resource: { id: 1 } },
        { ok: true, status: 'existing', resource: { id: 1 } },
      ],
    });
    expect(server.xClient.calls.filter((call) => call.name === 'getTweet')).toHaveLength(1);
    expect((await list()).total).toBe(1);
    const status = (await (await request('/api/status')).json()) as {
      month_cost_usd: number;
    };
    expect(status.month_cost_usd).toBe(0.025);
  });

  test('settles a concurrent save of the same tweet into one resource', async () => {
    // Given: two batches racing on the same tweet URL
    await connect();

    // When
    const [a, b] = await Promise.all([
      request('/api/resources/tweets', {
        method: 'POST',
        body: JSON.stringify({ urls: ['https://x.com/perchtester/status/1'] }),
      }),
      request('/api/resources/tweets', {
        method: 'POST',
        body: JSON.stringify({ urls: ['https://x.com/perchtester/status/1'] }),
      }),
    ]);

    // Then: one wins the insert, the other recovers onto the existing row
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const results = [
      ...((await a.json()) as { results: Array<{ status: string; resource: { id: number } }> })
        .results,
      ...((await b.json()) as { results: Array<{ status: string; resource: { id: number } }> })
        .results,
    ];
    expect(results.map((result) => result.status).sort()).toEqual(['created', 'existing']);
    expect(results.map((result) => result.resource.id)).toEqual([1, 1]);
    expect((await list()).total).toBe(1);
    expect(server.xClient.calls.filter((call) => call.name === 'getTweet')).toHaveLength(2);
    const status = (await (await request('/api/status')).json()) as {
      month_cost_usd: number;
    };
    expect(status.month_cost_usd).toBe(0.04);
  });

  test('refreshes on purpose and updates the text', async () => {
    // Given: one saved tweet whose text changed on X
    await connect();
    await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://x.com/perchtester/status/1'] }),
    });
    server.xClient.tweet.text = 'hello edited';

    // When
    const response = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['https://x.com/perchtester/status/1'],
        refresh: true,
      }),
    });

    // Then
    expect(await response.json()).toMatchObject({
      results: [
        {
          ok: true,
          status: 'refreshed',
          resource: { text: 'hello edited', title: 'hello edited' },
        },
      ],
    });
    expect(server.xClient.calls.filter((call) => call.name === 'getTweet')).toHaveLength(2);
    const status = (await (await request('/api/status')).json()) as {
      month_cost_usd: number;
    };
    expect(status.month_cost_usd).toBe(0.04);
  });

  test('filters by author and by date saved', async () => {
    // Given: two tweets by two authors and one note
    await connect();
    server.xClient.tweets['2'] = {
      ...server.xClient.tweet,
      id: '2',
      authorId: '2000',
      authorUsername: 'Other_One',
    };
    await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['https://x.com/perchtester/status/1', 'https://x.com/perchtester/status/2'],
      }),
    });
    const note = await request('/api/resources/notes', {
      method: 'POST',
      body: JSON.stringify({ body: '# Note' }),
    });
    expect(note.status).toBe(201);

    // When/Then
    expect((await list('?author=other_one')).items.map((item) => item.id)).toEqual([2]);
    expect((await list('?author=@Other_One')).items.map((item) => item.id)).toEqual([2]);
    expect((await list('?author=nobody')).items).toEqual([]);

    const authors = await request('/api/resources/authors');
    expect(authors.status).toBe(200);
    expect(await authors.json()).toEqual({
      authors: [
        { username: 'Other_One', count: 1 },
        { username: 'perchtester', count: 1 },
      ],
    });

    expect((await list('?from=2026-09-04&to=2026-09-04')).total).toBe(3);
    expect((await list('?from=2026-09-05')).total).toBe(0);
    expect((await list('?to=2026-09-03')).total).toBe(0);

    const bad = await request('/api/resources?from=2026-13-01');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ errors: [{ path: 'from' }] });
  });

  test('reads the date range in the configured time zone', async () => {
    // Given: a resource saved at 18:00 UTC and a non-UTC timezone
    const local = await createTestServer({ now: new Date('2026-09-04T18:00:00Z') });
    try {
      const localRequest = (path: string, init: RequestInit = {}) => {
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${local.token}`);
        if (init.body) headers.set('Content-Type', 'application/json');
        return local.app.request(path, { ...init, headers });
      };
      const note = await localRequest('/api/resources/notes', {
        method: 'POST',
        body: JSON.stringify({ body: '# Note' }),
      });
      expect(note.status).toBe(201);
      const patch = await localRequest('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ timezone: 'Asia/Saigon' }),
      });
      expect(patch.status).toBe(200);

      // When/Then: 18:00 UTC is Sep 5 in Saigon and Sep 4 in UTC
      const inSaigon = await localRequest('/api/resources?from=2026-09-05');
      expect((await inSaigon.json()).total).toBe(1);
      const utc = await localRequest('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ timezone: 'UTC' }),
      });
      expect(utc.status).toBe(200);
      const inUtc = await localRequest('/api/resources?from=2026-09-05');
      expect((await inUtc.json()).total).toBe(0);
    } finally {
      local.cleanup();
    }
  });

  test('saves a tweet with tags', async () => {
    // Given: the connected fake account and canned tweet
    await connect();
    const callsBefore = server.xClient.calls.length;

    // When
    const first = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['https://x.com/perchtester/status/1'],
        tags: ['x-api'],
      }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      results: Array<{ resource: { tags: string[] } }>;
    };
    expect(firstBody.results[0]?.resource.tags).toEqual(['x-api']);

    const second = await request('/api/resources/tweets', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['https://x.com/perchtester/status/1'],
        tags: ['again'],
      }),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      results: Array<{ status: string; resource: { tags: string[] } }>;
    };
    expect(secondBody.results[0]?.status).toBe('existing');
    expect(secondBody.results[0]?.resource.tags).toEqual(['again', 'x-api']);

    // Then: the duplicate save made no new X call
    expect(server.xClient.calls.length).toBe(callsBefore + 1);
  });
});
