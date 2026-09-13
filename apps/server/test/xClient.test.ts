import { describe, expect, test } from 'bun:test';

import { XError } from '../src/x/client';
import { createRealXClient } from '../src/x/real';

type RecordedCall = { url: string; init: RequestInit | undefined };

function recordingFetch(...responses: Response[]) {
  const calls: RecordedCall[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.length > 1 ? responses.shift() : responses[0];
    if (!next) throw new Error('no canned response left');
    return next;
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

describe('real X client', () => {
  test('exchanges a code as a confidential client', async () => {
    const stub = recordingFetch(
      Response.json({
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 7200,
        scope: 's',
        token_type: 'bearer',
      }),
    );
    const client = createRealXClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: stub.fetch,
    });

    const tokens = await client.exchangeCode({
      code: 'c',
      codeVerifier: 'v',
      redirectUri: 'http://127.0.0.1:3000/auth/x/callback',
    });

    expect(tokens).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 7200,
      scope: 's',
    });
    expect(stub.calls).toHaveLength(1);
    const call = stub.calls[0];
    if (!call) throw new Error('expected a recorded call');
    expect(call.url).toBe('https://api.x.com/2/oauth2/token');
    expect(call.init?.method).toBe('POST');
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Basic aWQ6c2VjcmV0');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(call.init?.body).toBe(
      'grant_type=authorization_code&code=c&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fauth%2Fx%2Fcallback&code_verifier=v',
    );
  });

  test('refreshes a token', async () => {
    const stub = recordingFetch(
      Response.json({
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 7200,
        scope: 's',
        token_type: 'bearer',
      }),
    );
    const client = createRealXClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: stub.fetch,
    });

    const tokens = await client.refreshToken('r0');

    expect(stub.calls[0]?.init?.body).toBe('grant_type=refresh_token&refresh_token=r0');
    expect(tokens).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 7200,
      scope: 's',
    });
  });

  test('revokes a token', async () => {
    const stub = recordingFetch(Response.json({ revoked: true }));
    const client = createRealXClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: stub.fetch,
    });

    await client.revokeToken('a');

    expect(stub.calls[0]?.url).toBe('https://api.x.com/2/oauth2/revoke');
    expect(stub.calls[0]?.init?.body).toBe('token=a');
    const headers = stub.calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Basic aWQ6c2VjcmV0');
  });

  test('reads me with subscription type', async () => {
    const stub = recordingFetch(
      Response.json({
        data: {
          id: '1000',
          name: 'Perch Tester',
          username: 'perchtester',
          subscription_type: 'Premium',
        },
      }),
    );
    const client = createRealXClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: stub.fetch,
    });

    const me = await client.getMe('a');

    expect(me).toEqual({
      id: '1000',
      username: 'perchtester',
      name: 'Perch Tester',
      subscriptionType: 'Premium',
    });
    expect(stub.calls[0]?.url).toBe('https://api.x.com/2/users/me?user.fields=subscription_type');
    const headers = stub.calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer a');
  });

  test('maps a 400 from the token endpoint to invalid_grant', async () => {
    const stub = recordingFetch(
      Response.json({ error: 'invalid_grant', error_description: 'expired' }, { status: 400 }),
    );
    const client = createRealXClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: stub.fetch,
    });

    try {
      await client.refreshToken('dead');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(XError);
      expect((error as XError).kind).toBe('invalid_grant');
      expect((error as XError).status).toBe(400);
    }
  });

  test('reads a tweet, uploads media, and creates a post', async () => {
    const stub = recordingFetch(
      Response.json({
        data: {
          id: '1',
          text: 'hi',
          author_id: '9',
          created_at: '2020-05-12T19:44:51.000Z',
          note_tweet: { text: 'long' },
        },
        includes: { users: [{ id: '9', username: 'someone' }] },
      }),
      Response.json({ data: { id: 'm1' } }),
      Response.json({ data: { id: '2' } }),
    );
    const client = createRealXClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: stub.fetch,
    });

    const tweet = await client.getTweet('a', '1');
    const media = await client.uploadMedia('a', {
      bytes: new Uint8Array([1]),
      mediaType: 'image/png',
    });
    const post = await client.createPost('a', { text: 'x', mediaIds: ['m1'] });

    expect(tweet).toEqual({
      id: '1',
      text: 'hi',
      authorId: '9',
      authorUsername: 'someone',
      hasMedia: false,
      isArticle: false,
      noteText: 'long',
      referencedTweets: [],
      createdAt: '2020-05-12T19:44:51.000Z',
    });
    expect(media).toEqual({ mediaId: 'm1' });
    expect(post).toEqual({ id: '2' });
    expect(stub.calls[0]?.url).toContain('https://api.x.com/2/tweets/1?');
    expect(stub.calls[0]?.url).toContain(
      'tweet.fields=attachments,article,author_id,created_at,note_tweet,referenced_tweets,text',
    );
    expect(stub.calls[1]?.url).toBe('https://api.x.com/2/media/upload');
    expect(stub.calls[2]?.url).toBe('https://api.x.com/2/tweets');
  });

  test('uploads an image with only media and media_category', async () => {
    const stub = recordingFetch(Response.json({ data: { id: 'm1' } }));
    const client = createRealXClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: stub.fetch,
    });

    const media = await client.uploadMedia('a', {
      bytes: new Uint8Array([1]),
      mediaType: 'image/png',
    });

    expect(media).toEqual({ mediaId: 'm1' });
    expect(JSON.parse(String(stub.calls[0]?.init?.body))).toEqual({
      media: 'AQ==',
      media_category: 'tweet_image',
    });
  });

  test('uploads a gif as tweet_gif', async () => {
    const stub = recordingFetch(Response.json({ data: { id: 'm1' } }));
    const client = createRealXClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: stub.fetch,
    });

    await client.uploadMedia('a', { bytes: new Uint8Array([1]), mediaType: 'image/gif' });

    expect(JSON.parse(String(stub.calls[0]?.init?.body))).toEqual({
      media: 'AQ==',
      media_category: 'tweet_gif',
    });
  });

  test('maps a create-post 200 without data to an XError', async () => {
    const stub = recordingFetch(
      Response.json({ errors: [{ detail: 'You are not allowed to create a Post' }] }),
    );
    const client = createRealXClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: stub.fetch,
    });

    try {
      await client.createPost('a', { text: 'x' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(XError);
      expect((error as XError).kind).toBe('http');
      expect((error as XError).status).toBe(200);
      expect((error as XError).message).toBe('You are not allowed to create a Post');
    }
  });

  test('maps a 200 with errors and no data to a 404', async () => {
    const stub = recordingFetch(
      Response.json({
        errors: [
          {
            title: 'Not Found Error',
            detail: 'Could not find tweet with id: [456].',
            type: 'https://api.x.com/2/problems/resource-not-found',
          },
        ],
      }),
    );
    const client = createRealXClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: stub.fetch,
    });

    try {
      await client.getTweet('a', '456');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(XError);
      expect((error as XError).kind).toBe('http');
      expect((error as XError).status).toBe(404);
      expect((error as XError).message).toBe('Could not find tweet with id: [456].');
    }
  });
});
