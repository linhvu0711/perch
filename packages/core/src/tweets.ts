import { NOTE_TITLE_FALLBACK, RESOURCE_TITLE_MAX } from './resources';

export const TWEET_REJECTIONS = {
  is_retweet: 'Post is a retweet',
  is_reply: 'Post is a reply',
  is_quote: 'Post is a quote',
  is_article: 'Post is an article',
  has_media: 'Post has media',
} as const;

export type TweetRejectionCode = keyof typeof TWEET_REJECTIONS;

export function parseTweetUrl(input: string): { id: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (
    ![
      'x.com',
      'www.x.com',
      'mobile.x.com',
      'twitter.com',
      'www.twitter.com',
      'mobile.twitter.com',
    ].includes(url.hostname)
  ) {
    return null;
  }
  const match = url.pathname.match(/^\/(?:i\/web|[A-Za-z0-9_]{1,15})\/status\/(\d{1,19})(?:\/|$)/);
  return match?.[1] ? { id: match[1] } : null;
}

export function tweetRejection(tweet: {
  hasMedia: boolean;
  isArticle: boolean;
  referencedTweets: Array<{ type: string }>;
}): { code: TweetRejectionCode; message: string } | null {
  const referenced = new Set(tweet.referencedTweets.map((item) => item.type));
  const code = referenced.has('retweeted')
    ? 'is_retweet'
    : referenced.has('replied_to')
      ? 'is_reply'
      : referenced.has('quoted')
        ? 'is_quote'
        : tweet.isArticle
          ? 'is_article'
          : tweet.hasMedia
            ? 'has_media'
            : null;
  return code ? { code, message: TWEET_REJECTIONS[code] } : null;
}

export function tweetTitle(text: string): string {
  const firstLine = (text.split(/\r?\n/, 1)[0] ?? '').replace(/\s+/g, ' ').trim();
  return firstLine.slice(0, RESOURCE_TITLE_MAX) || NOTE_TITLE_FALLBACK;
}
