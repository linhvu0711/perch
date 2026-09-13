import { expect, test } from 'bun:test';

import {
  parseTweetUrl,
  type TweetRejectionCode,
  tweetRejection,
  tweetTitle,
} from '../src/tweets';

test('parseTweetUrl', () => {
  // Given: the URL forms below
  const cases: Array<[string, { id: string } | null]> = [
    ['https://x.com/perchtester/status/1', { id: '1' }],
    ['https://twitter.com/perchtester/status/1?s=20&t=abc', { id: '1' }],
    ['http://mobile.twitter.com/a_b/status/123/photo/1', { id: '123' }],
    ['https://www.x.com/i/web/status/9#top', { id: '9' }],
    [' https://x.com/perchtester/status/1 ', { id: '1' }],
    ['https://x.com/perchtester', null],
    ['https://example.com/perchtester/status/1', null],
    ['https://x.com/perchtester/status/abc', null],
    ['not a url', null],
  ];
  // When/Then
  for (const [input, expected] of cases) {
    expect(parseTweetUrl(input)).toEqual(expected);
  }
});

test('tweetRejection names the first reason in order', () => {
  // Given: tweets carrying each rejection signal
  const cases: Array<[
    { hasMedia: boolean; isArticle: boolean; referencedTweets: Array<{ type: string }> },
    { code: TweetRejectionCode; message: string } | null,
  ]> = [
    [
      { hasMedia: true, isArticle: true, referencedTweets: [{ type: 'retweeted' }] },
      { code: 'is_retweet', message: 'Post is a retweet' },
    ],
    [
      { hasMedia: false, isArticle: false, referencedTweets: [{ type: 'replied_to' }] },
      { code: 'is_reply', message: 'Post is a reply' },
    ],
    [
      { hasMedia: false, isArticle: false, referencedTweets: [{ type: 'quoted' }] },
      { code: 'is_quote', message: 'Post is a quote' },
    ],
    [
      { hasMedia: true, isArticle: true, referencedTweets: [] },
      { code: 'is_article', message: 'Post is an article' },
    ],
    [
      { hasMedia: true, isArticle: false, referencedTweets: [] },
      { code: 'has_media', message: 'Post has media' },
    ],
    [{ hasMedia: false, isArticle: false, referencedTweets: [] }, null],
  ];
  // When/Then
  for (const [tweet, expected] of cases) {
    expect(tweetRejection(tweet)).toEqual(expected);
  }
});

test('tweetTitle', () => {
  // Given: texts that exercise the derivation
  const cases: Array<[string, string]> = [
    ['hello', 'hello'],
    ['first line\nsecond', 'first line'],
    ['  a   b  ', 'a b'],
    ['x'.repeat(250), 'x'.repeat(200)],
    ['', 'Untitled'],
  ];
  // When/Then
  for (const [text, expected] of cases) {
    expect(tweetTitle(text)).toBe(expected);
  }
});
