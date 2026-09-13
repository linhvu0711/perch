import {
  parseTweetUrl,
  type TweetCreate,
  type TweetCreateResponse,
  type TweetResource,
  tweetRejection,
  tweetTitle,
  X_COSTS_USD,
  X_ENDPOINTS,
} from '@perch/core';

import type { Clock } from '../clock';
import type { Db } from '../db';
import { logApiCall } from '../db/apiCalls';
import { createTweet, findTweetByXId, updateTweet } from '../db/resources';
import type { XAccountService } from './accounts';
import type { XTweet } from './client';
import { type XClient, XError } from './client';

export interface TweetService {
  saveTweets(userId: number, input: TweetCreate): Promise<TweetCreateResponse>;
}

export function createTweetService(deps: {
  db: Db;
  clock: Clock;
  accounts: XAccountService;
  xClient: XClient;
}): TweetService {
  return {
    async saveTweets(userId, input) {
      const { account, accessToken } = await deps.accounts.accessTokenFor(userId);
      const results: TweetCreateResponse['results'] = [];

      for (const url of input.urls) {
        const parsed = parseTweetUrl(url);
        if (!parsed) {
          results.push({
            url,
            ok: false,
            error: { code: 'invalid_url', message: 'Not a tweet URL' },
          });
          continue;
        }

        const existing = findTweetByXId(deps.db, userId, parsed.id);
        if (existing && !input.refresh) {
          results.push({ url, ok: true, status: 'existing', resource: existing });
          continue;
        }

        let tweet: XTweet;
        try {
          tweet = await deps.xClient.getTweet(accessToken, parsed.id);
        } catch (error) {
          if (!(error instanceof XError)) throw error;
          results.push({
            url,
            ok: false,
            error:
              error.status === 404
                ? { code: 'not_found', message: 'Tweet not found or not readable' }
                : { code: 'x_error', message: `X error: ${error.message}` },
          });
          continue;
        }

        const rejection = tweetRejection(tweet);
        const now = deps.clock.now();
        if (rejection) {
          // X served the tweet, so the fetch is charged without a resource.
          logApiCall(deps.db, userId, {
            endpoint: X_ENDPOINTS.getTweet,
            costUsd: X_COSTS_USD.saveTweet,
            xAccountId: account.id,
            now,
          });
          results.push({ url, ok: false, error: rejection });
          continue;
        }

        const text = tweet.noteText ?? tweet.text;
        const canonicalUrl = `https://x.com/${tweet.authorUsername}/status/${tweet.id}`;
        let resource: TweetResource;
        try {
          resource = deps.db.transaction((tx) => {
            const saved = existing
              ? updateTweet(tx, userId, existing.id, {
                  url: canonicalUrl,
                  authorId: tweet.authorId,
                  authorUsername: tweet.authorUsername,
                  text,
                  title: tweetTitle(text),
                  postedAt: new Date(tweet.createdAt),
                })
              : createTweet(
                  tx,
                  userId,
                  {
                    url: canonicalUrl,
                    xId: tweet.id,
                    authorId: tweet.authorId,
                    authorUsername: tweet.authorUsername,
                    text,
                    title: tweetTitle(text),
                    postedAt: new Date(tweet.createdAt),
                  },
                  now,
                );
            if (!saved) throw new Error('tweet resource update failed');
            logApiCall(tx, userId, {
              endpoint: X_ENDPOINTS.getTweet,
              costUsd: X_COSTS_USD.saveTweet,
              resourceId: saved.id,
              xAccountId: account.id,
              now,
            });
            return saved;
          });
        } catch (error) {
          const raced = !existing && findTweetByXId(deps.db, userId, parsed.id);
          if (
            !(error instanceof Error && error.message.includes('UNIQUE constraint failed')) ||
            !raced
          ) {
            throw error;
          }
          logApiCall(deps.db, userId, {
            endpoint: X_ENDPOINTS.getTweet,
            costUsd: X_COSTS_USD.saveTweet,
            resourceId: raced.id,
            xAccountId: account.id,
            now,
          });
          results.push({ url, ok: true, status: 'existing', resource: raced });
          continue;
        }
        results.push({
          url,
          ok: true,
          status: existing ? 'refreshed' : 'created',
          resource,
        });
      }

      return { results };
    },
  };
}
