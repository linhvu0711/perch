import type { XClient, XMe, XTokens, XTweet } from './client';

export interface FakeXClient extends XClient {
  calls: Array<{ name: string; args: unknown[] }>;
  me: XMe;
  tokens: XTokens;
  refreshed: XTokens;
  tweet: XTweet;
  tweets: Record<string, XTweet>;
  tweetErrors: Record<string, Error>;
  mediaId: string;
  createdPost: { id: string };
  exchangeError: Error | null;
  refreshError: Error | null;
  meError: Error | null;
  revokeError: Error | null;
}

export function fakeXClient(): FakeXClient {
  const scope = 'tweet.read tweet.write users.read media.write offline.access';
  const fake: FakeXClient = {
    calls: [],
    me: {
      id: '1000',
      username: 'perchtester',
      name: 'Perch Tester',
      subscriptionType: 'Premium',
    },
    tokens: {
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresIn: 7200,
      scope,
    },
    refreshed: {
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresIn: 7200,
      scope,
    },
    tweet: {
      id: '1',
      text: 'hello',
      authorId: '1000',
      authorUsername: 'perchtester',
      postedAt: '2026-09-01T12:00:00.000Z',
      hasMedia: false,
      isArticle: false,
      noteText: null,
      referencedTweets: [],
    },
    tweets: {
      '1': {
        id: '1',
        text: 'Ship the smallest thing that works, then make it right.',
        authorId: '1000',
        authorUsername: 'perchtester',
        postedAt: '2026-09-01T12:00:00.000Z',
        hasMedia: false,
        isArticle: false,
        noteText: null,
        referencedTweets: [],
      },
      '2': {
        id: '2',
        text: 'media',
        authorId: '1000',
        authorUsername: 'perchtester',
        postedAt: '2026-09-02T12:00:00.000Z',
        hasMedia: true,
        isArticle: false,
        noteText: null,
        referencedTweets: [],
      },
      '3': {
        id: '3',
        text: 'note',
        authorId: '1000',
        authorUsername: 'perchtester',
        postedAt: '2026-09-03T12:00:00.000Z',
        hasMedia: false,
        isArticle: false,
        noteText: 'A long-form post. '.repeat(20),
        referencedTweets: [],
      },
    },
    tweetErrors: {},
    mediaId: 'media-1',
    createdPost: { id: '2' },
    exchangeError: null,
    refreshError: null,
    meError: null,
    revokeError: null,

    async exchangeCode(input) {
      fake.calls.push({ name: 'exchangeCode', args: [input] });
      if (fake.exchangeError) throw fake.exchangeError;
      return fake.tokens;
    },
    async refreshToken(refreshToken) {
      fake.calls.push({ name: 'refreshToken', args: [refreshToken] });
      if (fake.refreshError) throw fake.refreshError;
      return fake.refreshed;
    },
    async revokeToken(token) {
      fake.calls.push({ name: 'revokeToken', args: [token] });
      if (fake.revokeError) throw fake.revokeError;
    },
    async getMe(accessToken) {
      fake.calls.push({ name: 'getMe', args: [accessToken] });
      if (fake.meError) throw fake.meError;
      return fake.me;
    },
    async getTweet(accessToken, id) {
      fake.calls.push({ name: 'getTweet', args: [accessToken, id] });
      const error = fake.tweetErrors[id];
      if (error) throw error;
      if (fake.tweets[id]) return fake.tweets[id];
      return fake.tweet;
    },
    async uploadMedia(accessToken, input) {
      fake.calls.push({ name: 'uploadMedia', args: [accessToken, input] });
      return { mediaId: fake.mediaId };
    },
    async createPost(accessToken, input) {
      fake.calls.push({ name: 'createPost', args: [accessToken, input] });
      return fake.createdPost;
    },
  };
  return fake;
}
