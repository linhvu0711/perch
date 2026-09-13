import {
  XError,
  type XClient,
  type XMe,
  type XTokens,
  type XTweet,
} from './client';

const X_API_BASE = 'https://api.x.com';

export function createRealXClient(options: {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
}): XClient {
  const fetchImpl = options.fetch ?? fetch;
  const basic =
    'Basic ' + btoa(`${options.clientId}:${options.clientSecret}`);

  async function request(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (error) {
      throw new XError(
        'network',
        null,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let body: { error?: string; error_description?: string } | null = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      if (res.status === 400 || res.status === 401) {
        throw new XError(
          'invalid_grant',
          res.status,
          body?.error_description ?? body?.error ?? 'invalid grant',
        );
      }
      throw new XError('http', res.status, text || `HTTP ${res.status}`);
    }
    return res;
  }

  function tokenHeaders(): Record<string, string> {
    return {
      Authorization: basic,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }

  async function tokenRequest(body: URLSearchParams): Promise<XTokens> {
    const res = await request(`${X_API_BASE}/2/oauth2/token`, {
      method: 'POST',
      headers: tokenHeaders(),
      body: body.toString(),
    });
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };
    if (!data.refresh_token) {
      throw new XError(
        'http',
        res.status,
        'token response missing refresh_token',
      );
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
    };
  }

  function bearerHeaders(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}` };
  }

  return {
    async exchangeCode(input) {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      });
      return tokenRequest(body);
    },

    async refreshToken(refreshToken) {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      return tokenRequest(body);
    },

    async revokeToken(token) {
      await request(`${X_API_BASE}/2/oauth2/revoke`, {
        method: 'POST',
        headers: tokenHeaders(),
        body: new URLSearchParams({ token }).toString(),
      });
    },

    async getMe(accessToken) {
      const res = await request(
        `${X_API_BASE}/2/users/me?user.fields=subscription_type`,
        { headers: bearerHeaders(accessToken) },
      );
      const data = (await res.json()) as {
        data: {
          id: string;
          username: string;
          name: string;
          subscription_type?: string;
        };
      };
      return {
        id: data.data.id,
        username: data.data.username,
        name: data.data.name,
        subscriptionType: data.data.subscription_type ?? 'None',
      };
    },

    async getTweet(accessToken, id) {
      const res = await request(
        `${X_API_BASE}/2/tweets/${id}?tweet.fields=attachments,article,author_id,note_tweet,referenced_tweets,text&expansions=author_id,attachments.media_keys&user.fields=username`,
        { headers: bearerHeaders(accessToken) },
      );
      const data = (await res.json()) as {
        data: {
          id: string;
          text: string;
          author_id?: string;
          attachments?: { media_keys?: string[] };
          article?: unknown;
          note_tweet?: { text: string };
          referenced_tweets?: Array<{ type: string; id: string }>;
        };
        includes?: { users?: Array<{ id: string; username: string }> };
      };
      const author = data.includes?.users?.find(
        (u) => u.id === data.data.author_id,
      );
      const tweet: XTweet = {
        id: data.data.id,
        text: data.data.text,
        authorUsername: author?.username ?? '',
        hasMedia: (data.data.attachments?.media_keys?.length ?? 0) > 0,
        isArticle: data.data.article != null,
        noteText: data.data.note_tweet?.text ?? null,
        referencedTweets: data.data.referenced_tweets ?? [],
      };
      return tweet;
    },

    async uploadMedia(accessToken, input) {
      const res = await request(`${X_API_BASE}/2/media/upload`, {
        method: 'POST',
        headers: {
          ...bearerHeaders(accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          media: Buffer.from(input.bytes).toString('base64'),
          media_category: 'tweet_image',
          media_type: input.mediaType,
        }),
      });
      const data = (await res.json()) as { data: { id: string } };
      return { mediaId: data.data.id };
    },

    async createPost(accessToken, input) {
      const res = await request(`${X_API_BASE}/2/tweets`, {
        method: 'POST',
        headers: {
          ...bearerHeaders(accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          input.mediaIds && input.mediaIds.length > 0
            ? { text: input.text, media: { media_ids: input.mediaIds } }
            : { text: input.text },
        ),
      });
      const data = (await res.json()) as { data: { id: string } };
      return { id: data.data.id };
    },
  };
}
