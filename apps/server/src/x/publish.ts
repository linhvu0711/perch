import fs from 'node:fs';
import path from 'node:path';

import {
  estimateCost,
  nextAttemptAt,
  type Post,
  PUBLISH_FROM,
  RETRY_FROM,
  X_COSTS_USD,
  X_ENDPOINTS,
} from '@perch/core';
import { and, eq } from 'drizzle-orm';

import type { Clock } from '../clock';
import type { Db } from '../db';
import { logApiCall } from '../db/apiCalls';
import { mediaRowsForPost } from '../db/postMedia';
import { duePosts, getPost, getPostRow, PostStatusError, promotePosts } from '../db/posts';
import { posts } from '../db/schema';
import type { XAccountRow } from '../db/xAccounts';
import { ApiError } from '../errors';
import { readMedia } from '../images';
import type { XAccountService } from './accounts';
import type { XClient } from './client';

export interface PublishService {
  publishNow(userId: number, id: number): Promise<Post | null>;
  retry(userId: number, id: number): Promise<Post | null>;
  sendDue(now: Date): Promise<void>;
}

type SendResult = { ok: true } | { ok: false; message: string };

export function createPublishService(deps: {
  db: Db;
  clock: Clock;
  xClient: XClient;
  accounts: XAccountService;
  uploadDir: string;
}): PublishService {
  const inFlight = new Set<number>();
  const fileExists = (rel: string) => fs.existsSync(path.join(deps.uploadDir, rel));

  async function send(
    row: { id: number; userId: number; text: string },
    account: XAccountRow,
    accessToken: string,
    now: Date,
  ): Promise<SendResult> {
    try {
      const mediaIds: string[] = [];
      for (const media of mediaRowsForPost(deps.db, row.id)) {
        const bytes = await readMedia(deps.uploadDir, media.path);
        if (!bytes) throw new Error(`Media ${media.position} file is missing`);
        const uploaded = await deps.xClient.uploadMedia(accessToken, {
          bytes,
          mediaType: media.mime,
        });
        logApiCall(deps.db, row.userId, {
          endpoint: X_ENDPOINTS.uploadMedia,
          costUsd: X_COSTS_USD.mediaUpload,
          postId: row.id,
          xAccountId: account.id,
          now,
        });
        mediaIds.push(uploaded.mediaId);
      }
      const created = await deps.xClient.createPost(
        accessToken,
        mediaIds.length > 0 ? { text: row.text, mediaIds } : { text: row.text },
      );
      deps.db.transaction((tx) => {
        tx.update(posts)
          .set({
            status: 'published',
            publishedAt: now,
            xAccountId: account.id,
            xPostId: created.id,
            scheduledAt: null,
            nextAttemptAt: null,
            lastError: null,
            updatedAt: now,
          })
          .where(eq(posts.id, row.id))
          .run();
        logApiCall(tx, row.userId, {
          endpoint: X_ENDPOINTS.createPost,
          costUsd: estimateCost(row.text),
          postId: row.id,
          xAccountId: account.id,
          now,
        });
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    async publishNow(userId, id) {
      const row = getPostRow(deps.db, userId, id);
      if (!row) return null;
      if (!(PUBLISH_FROM as readonly string[]).includes(row.status)) {
        throw new PostStatusError(id, row.status);
      }
      if (inFlight.has(id)) {
        throw new ApiError(409, 'in_flight', `Post ${id} is being sent`);
      }
      inFlight.add(id);
      try {
        const now = deps.clock.now();
        if (row.status === 'draft') {
          const { results } = promotePosts(deps.db, userId, [id], fileExists, now, false);
          const result = results[0];
          if (result && result.ok === false) {
            throw new ApiError(
              400,
              'validation',
              'Invalid request',
              result.error.errors ?? [{ path: 'status', message: result.error.message }],
            );
          }
        }
        const { account, accessToken } = await deps.accounts.accessTokenFor(userId);
        if (row.status === 'draft') {
          promotePosts(deps.db, userId, [id], fileExists, now);
        }
        const sent = await send(row, account, accessToken, now);
        if (!sent.ok) {
          deps.db
            .update(posts)
            .set({
              status: 'failed',
              lastError: sent.message,
              retryCount: row.retryCount + 1,
              updatedAt: now,
            })
            .where(and(eq(posts.id, id), eq(posts.userId, userId)))
            .run();
          throw new ApiError(502, 'publish_failed', sent.message);
        }
        return getPost(deps.db, userId, id, now);
      } finally {
        inFlight.delete(id);
      }
    },

    async retry(userId, id) {
      const row = getPostRow(deps.db, userId, id);
      if (!row) return null;
      if (!(RETRY_FROM as readonly string[]).includes(row.status)) {
        throw new PostStatusError(id, row.status);
      }
      if (inFlight.has(id)) {
        throw new ApiError(409, 'in_flight', `Post ${id} is being sent`);
      }
      inFlight.add(id);
      try {
        const { account, accessToken } = await deps.accounts.accessTokenFor(userId);
        const now = deps.clock.now();
        const sent = await send(row, account, accessToken, now);
        if (!sent.ok) {
          deps.db
            .update(posts)
            .set({
              lastError: sent.message,
              retryCount: row.retryCount + 1,
              updatedAt: now,
            })
            .where(and(eq(posts.id, id), eq(posts.userId, userId)))
            .run();
          throw new ApiError(502, 'publish_failed', sent.message);
        }
        return getPost(deps.db, userId, id, now);
      } finally {
        inFlight.delete(id);
      }
    },

    async sendDue(now) {
      for (const row of duePosts(deps.db, now)) {
        if (inFlight.has(row.id)) continue;
        inFlight.add(row.id);
        try {
          let account: XAccountRow;
          let accessToken: string;
          try {
            ({ account, accessToken } = await deps.accounts.accessTokenFor(row.userId));
          } catch (error) {
            if (error instanceof ApiError) continue;
            throw error;
          }
          const sent = await send(row, account, accessToken, now);
          if (!sent.ok) {
            const failedAttempts = row.retryCount + 1;
            const next = nextAttemptAt(row.scheduledAt!, failedAttempts);
            deps.db
              .update(posts)
              .set({
                retryCount: failedAttempts,
                lastError: sent.message,
                nextAttemptAt: next,
                updatedAt: now,
                ...(next === null ? { status: 'failed' as const } : {}),
              })
              .where(eq(posts.id, row.id))
              .run();
          }
        } finally {
          inFlight.delete(row.id);
        }
      }
    },
  };
}
