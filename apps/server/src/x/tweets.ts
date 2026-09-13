import {
  parseTweetUrl,
  tweetRejection,
  tweetTitle,
  X_COSTS_USD,
  X_ENDPOINTS,
  type TweetCreate,
  type TweetCreateResponse,
} from '@perch/core';

import type { Clock } from '../clock';
import {
  createTweet,
  getTweetByXId,
  updateTweet,
} from '../db/resources';
import type { Db } from '../db';
import { logApiCall } from '../db/apiCalls';
import { XError, type XClient } from './client';
import type { XAccountService } from './accounts';

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
      const access = await deps.accounts.accessTokenFor(userId);
      const results: TweetCreateResponse['results'] = [];

      for (const url of input.urls) {
        const parsed = parseTweetUrl(url);
        if (!parsed) {
          results.push({
            url,
            ok: false,
            error: { code: 'invalid_url', message: 'Invalid X post URL' },
          });
          continue;
        }

        const existing = getTweetByXId(deps.db, userId, parsed.id);
        if (existing && !input.refresh) {
          results.push({ url, ok: true, status: 'existing', resource: existing });
          continue;
        }

        let tweet;
        try {
          tweet = await deps.xClient.getTweet(access.accessToken, parsed.id);
        } catch (error) {
          if (error instanceof XError && error.status === 404) {
            results.push({
              url,
              ok: false,
              error: { code: 'not_found', message: 'Post not found' },
            });
          } else {
            results.push({
              url,
              ok: false,
              error: {
                code: 'x_error',
                message: error instanceof Error ? error.message : String(error),
              },
            });
          }
          continue;
        }

        const rejection = tweetRejection(tweet);
        const now = deps.clock.now();
        if (rejection) {
          logApiCall(deps.db, userId, {
            endpoint: X_ENDPOINTS.getTweet,
            costUsd: X_COSTS_USD.saveTweet,
            xAccountId: access.account.id,
            now,
          });
          results.push({ url, ok: false, error: rejection });
          continue;
        }

        const text = tweet.noteText ?? tweet.text;
        const canonicalUrl = `https://x.com/${tweet.authorUsername}/status/${tweet.id}`;
        const resource = existing
          ? updateTweet(deps.db, userId, existing.id, {
              url: canonicalUrl,
              xId: tweet.id,
              authorId: tweet.authorId ?? '',
              authorUsername: tweet.authorUsername,
              text,
              postedAt: new Date(tweet.postedAt ?? 0),
              title: existing.title === tweetTitle(existing.text) ? tweetTitle(text) : existing.title,
            })
          : createTweet(deps.db, userId, {
              url: canonicalUrl,
              xId: tweet.id,
              authorId: tweet.authorId ?? '',
              authorUsername: tweet.authorUsername,
              text,
              postedAt: new Date(tweet.postedAt ?? 0),
            }, now);
        if (!resource) throw new Error('tweet resource update failed');
        logApiCall(deps.db, userId, {
          endpoint: X_ENDPOINTS.getTweet,
          costUsd: X_COSTS_USD.saveTweet,
          resourceId: resource.id,
          xAccountId: access.account.id,
          now,
        });
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
