import { describe, expect, test } from 'bun:test';

import { parseTweetUrl, tweetRejection, tweetTitle } from '../src/tweets';

describe('tweet rules', () => {
  test('parses supported X URL forms', () => {
    expect(parseTweetUrl(' https://twitter.com/i/web/status/123?x=1#y ')).toEqual({ id: '123' });
    expect(parseTweetUrl('https://example.com/a/status/1')).toBeNull();
    expect(parseTweetUrl('https://x.com/a/status/not-a-number')).toBeNull();
  });

  test('applies rejection order', () => {
    expect(tweetRejection({
      hasMedia: true,
      isArticle: true,
      referencedTweets: [{ type: 'quoted' }, { type: 'retweeted' }],
    })).toEqual({ code: 'is_retweet', message: 'Post is a retweet' });
  });

  test('derives a compact title', () => {
    expect(tweetTitle('  First   line  \nsecond')).toBe('First line');
    expect(tweetTitle(' \nsecond')).toBe('Untitled');
  });
});
