import {
  DEMOTE_FROM,
  estimateCost,
  nextAttemptAt,
  type Post,
  type PostScheduleBody,
  type PostStatus,
  type PostStatusResponse,
  PROMOTE_FROM,
  PUBLISH_FROM,
  parseScheduleTime,
  promoteChecks,
  RETRY_FROM,
  SCHEDULE_FROM,
  X_COSTS_USD,
  X_ENDPOINTS,
} from '@perch/core';

import type { Clock } from './clock';
import type { Db } from './db';
import { logApiCall } from './db/apiCalls';
import { postState } from './db/postState';
import {
  duePosts,
  getPost,
  getPostRow,
  mediaRowsForPost,
  PostImmutableError,
  type PostRow,
  patchPostRow,
  postJoinRow,
  postLimit,
} from './db/posts';
import { getSettings } from './db/settings';
import type { XAccountRow } from './db/xAccounts';
import { DomainError } from './errors';
import { mediaFileExists, readMedia } from './images';
import type { XAccountService } from './x/accounts';
import type { XClient } from './x/client';

export class PostNotReadyError extends DomainError {
  constructor(errors: Array<{ path: string; message: string }>) {
    super('validation', null, 'Post is not ready', errors);
  }
}

export class PostStatusError extends DomainError {
  constructor(postId: number, status: PostStatus) {
    super('invalid_status', 'status', `Post ${postId} is ${status}`);
  }
}

export class ScheduleTimeError extends DomainError {
  constructor(message: string) {
    super('validation', 'at', message);
  }
}

export class InFlightError extends DomainError {
  constructor(postId: number) {
    super('in_flight', null, `Post ${postId} is being sent`);
  }
}

export class PublishFailedError extends DomainError {
  constructor(message: string) {
    super('publish_failed', null, message);
  }
}

export interface PostLifecycle {
  promote(userId: number, ids: number[]): PostStatusResponse;
  demote(userId: number, ids: number[]): PostStatusResponse;
  schedule(userId: number, id: number, body: PostScheduleBody): Post | null;
  unschedule(userId: number, ids: number[]): PostStatusResponse;
  dismiss(userId: number, ids: number[]): PostStatusResponse;
  publishNow(userId: number, id: number): Promise<Post | null>;
  retry(userId: number, id: number): Promise<Post | null>;
  sendDue(now: Date): Promise<void>;
  isInFlight(id: number): boolean;
}

type SendResult = { ok: true } | { ok: false; message: string };

function statusResultError(
  id: number,
  code: string,
  message: string,
  errors?: Array<{ path: string; message: string }>,
): { id: number; ok: false; error: { code: string; message: string; errors?: typeof errors } } {
  return { id, ok: false, error: { code, message, ...(errors ? { errors } : {}) } };
}

export function createPostLifecycle(deps: {
  db: Db;
  clock: Clock;
  xClient: XClient;
  accounts: XAccountService;
  uploadDir: string;
}): PostLifecycle {
  const fileExists = mediaFileExists(deps.uploadDir);
  const inFlight = new Set<number>();

  function checksFor(userId: number, row: PostRow): Array<{ path: string; message: string }> {
    return promoteChecks({
      text: row.text,
      limit: postLimit(deps.db, userId),
      media: mediaRowsForPost(deps.db, row.id).map((media) => ({
        position: media.position,
        present: fileExists(media.path),
      })),
    });
  }

  async function send(
    row: { id: number; userId: number; text: string },
    account: XAccountRow,
    accessToken: string,
    now: Date,
    fromStatus: PostStatus,
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
      const written = deps.db.transaction((tx) => {
        const patched = patchPostRow(
          tx,
          row.userId,
          row.id,
          {
            status: 'published',
            publishedAt: now,
            xAccountId: account.id,
            xPostId: created.id,
            scheduledAt: null,
            nextAttemptAt: null,
            lastError: null,
          },
          now,
          fromStatus,
        );
        logApiCall(tx, row.userId, {
          endpoint: X_ENDPOINTS.createPost,
          costUsd: estimateCost(row.text),
          postId: row.id,
          xAccountId: account.id,
          now,
        });
        return patched;
      });
      if (!written) return { ok: false, message: `Post ${row.id} changed during send` };
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    promote(userId, ids) {
      const now = deps.clock.now();
      return {
        results: ids.map((id) => {
          const row = getPostRow(deps.db, userId, id);
          if (!row) {
            return statusResultError(id, 'not_found', `Post ${id} not found`);
          }
          if (!(PROMOTE_FROM as readonly string[]).includes(row.status)) {
            return statusResultError(id, 'invalid_status', `Post ${id} is ${row.status}`);
          }
          const checks = checksFor(userId, row);
          if (checks.length > 0) {
            return statusResultError(id, 'validation', `Post ${id} is not ready`, checks);
          }
          patchPostRow(deps.db, userId, id, { status: 'official' }, now);
          return { id, ok: true as const };
        }),
      };
    },

    demote(userId, ids) {
      const now = deps.clock.now();
      return {
        results: ids.map((id) => {
          const row = getPostRow(deps.db, userId, id);
          if (!row) {
            return statusResultError(id, 'not_found', `Post ${id} not found`);
          }
          if (inFlight.has(id)) {
            return statusResultError(id, 'in_flight', `Post ${id} is being sent`);
          }
          if (!(DEMOTE_FROM as readonly string[]).includes(row.status)) {
            return statusResultError(id, 'invalid_status', `Post ${id} is ${row.status}`);
          }
          patchPostRow(
            deps.db,
            userId,
            id,
            { status: 'draft', lastError: null, retryCount: 0, nextAttemptAt: null },
            now,
          );
          return { id, ok: true as const };
        }),
      };
    },

    schedule(userId, id, body) {
      const row = getPostRow(deps.db, userId, id);
      if (!row) return null;
      if (inFlight.has(id)) throw new InFlightError(id);
      if (row.status === 'published') throw new PostImmutableError(id);
      if (!(SCHEDULE_FROM as readonly string[]).includes(row.status)) {
        throw new PostStatusError(id, row.status);
      }
      const now = deps.clock.now();
      const at = parseScheduleTime(body.at, getSettings(deps.db, userId).timezone, now);
      if (at === null) throw new ScheduleTimeError('Unrecognised time');
      if (at.getTime() < now.getTime() && body.force !== true) {
        throw new ScheduleTimeError('Time is in the past');
      }
      patchPostRow(
        deps.db,
        userId,
        id,
        { scheduledAt: at, nextAttemptAt: null, lastError: null, retryCount: 0 },
        now,
      );
      return getPost(deps.db, userId, id, now, fileExists);
    },

    unschedule(userId, ids) {
      const now = deps.clock.now();
      return {
        results: ids.map((id) => {
          const row = getPostRow(deps.db, userId, id);
          if (!row) {
            return statusResultError(id, 'not_found', `Post ${id} not found`);
          }
          if (inFlight.has(id)) {
            return statusResultError(id, 'in_flight', `Post ${id} is being sent`);
          }
          if (!(SCHEDULE_FROM as readonly string[]).includes(row.status)) {
            return statusResultError(id, 'invalid_status', `Post ${id} is ${row.status}`);
          }
          patchPostRow(
            deps.db,
            userId,
            id,
            { scheduledAt: null, nextAttemptAt: null, lastError: null, retryCount: 0 },
            now,
          );
          return { id, ok: true as const };
        }),
      };
    },

    dismiss(userId, ids) {
      const now = deps.clock.now();
      return {
        results: ids.map((id) => {
          const row = postJoinRow(deps.db, userId, id, now);
          if (row === undefined) {
            return statusResultError(id, 'not_found', `Post ${id} not found`);
          }
          if (inFlight.has(id)) {
            return statusResultError(id, 'in_flight', `Post ${id} is being sent`);
          }
          const { dismiss } = postState(row);
          if (dismiss === null) {
            return statusResultError(id, 'invalid_status', `Post ${id} needs no attention`);
          }
          const patch =
            dismiss === 'demote'
              ? {
                  status: 'draft' as const,
                  scheduledAt: null,
                  nextAttemptAt: null,
                  lastError: null,
                  retryCount: 0,
                }
              : { scheduledAt: null, nextAttemptAt: null, lastError: null, retryCount: 0 };
          if (!patchPostRow(deps.db, userId, id, patch, now, row.status)) {
            return statusResultError(id, 'invalid_status', `Post ${id} changed; try again`);
          }
          return { id, ok: true as const };
        }),
      };
    },

    async publishNow(userId, id) {
      const row = getPostRow(deps.db, userId, id);
      if (!row) return null;
      if (!(PUBLISH_FROM as readonly string[]).includes(row.status)) {
        throw new PostStatusError(id, row.status);
      }
      if (inFlight.has(id)) {
        throw new InFlightError(id);
      }
      inFlight.add(id);
      try {
        const now = deps.clock.now();
        if (row.status === 'draft') {
          const checks = checksFor(userId, row);
          if (checks.length > 0) {
            throw new PostNotReadyError(checks);
          }
        }
        const { account, accessToken } = await deps.accounts.accessTokenFor(userId);
        if (row.status === 'draft') {
          patchPostRow(deps.db, userId, id, { status: 'official' }, now);
        }
        const sent = await send(row, account, accessToken, now, 'official');
        if (!sent.ok) {
          patchPostRow(
            deps.db,
            userId,
            id,
            { status: 'failed', lastError: sent.message, retryCount: row.retryCount + 1 },
            now,
          );
          throw new PublishFailedError(sent.message);
        }
        return getPost(deps.db, userId, id, now, fileExists);
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
        throw new InFlightError(id);
      }
      inFlight.add(id);
      try {
        const { account, accessToken } = await deps.accounts.accessTokenFor(userId);
        const now = deps.clock.now();
        const sent = await send(row, account, accessToken, now, 'failed');
        if (!sent.ok) {
          patchPostRow(
            deps.db,
            userId,
            id,
            { lastError: sent.message, retryCount: row.retryCount + 1 },
            now,
          );
          throw new PublishFailedError(sent.message);
        }
        return getPost(deps.db, userId, id, now, fileExists);
      } finally {
        inFlight.delete(id);
      }
    },

    isInFlight(id) {
      return inFlight.has(id);
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
            if (error instanceof DomainError) continue;
            throw error;
          }
          const sent = await send(row, account, accessToken, now, 'official');
          if (!sent.ok) {
            const failedAttempts = row.retryCount + 1;
            const next = nextAttemptAt(row.scheduledAt ?? now, failedAttempts);
            patchPostRow(
              deps.db,
              row.userId,
              row.id,
              {
                retryCount: failedAttempts,
                lastError: sent.message,
                nextAttemptAt: next,
                ...(next === null ? { status: 'failed' as const } : {}),
              },
              now,
            );
          }
        } finally {
          inFlight.delete(row.id);
        }
      }
    },
  };
}
