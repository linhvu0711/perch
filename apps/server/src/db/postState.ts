import type { PostStatus } from '@perch/core';
import { eq, or, type SQL, sql } from 'drizzle-orm';

import { posts } from './schema';

export interface PostState {
  missed: boolean;
  reason: string | null;
  dismiss: 'demote' | 'unschedule' | null;
}

export function accountConnectedAtSql(userId: number | typeof posts.userId, at: SQL): SQL {
  return sql`EXISTS (select 1 from x_accounts where x_accounts.user_id = ${userId} and x_accounts.connected_at <= ${at} and (x_accounts.disconnected_at is null or x_accounts.disconnected_at > ${at}))`;
}

/**
 * Scheduled posts whose time has already passed without Perch sending them:
 * drafts that were never promoted, or officials scheduled while the account
 * was disconnected.
 */
export function missedSql(userId: number | typeof posts.userId, now: Date): SQL {
  return sql`${posts.scheduledAt} IS NOT NULL
    AND ${posts.scheduledAt} < ${now.getTime()}
    AND (
      ${posts.status} = 'draft'
      OR (${posts.status} = 'official' AND NOT ${accountConnectedAtSql(userId, sql`${posts.scheduledAt}`)})
    )`;
}

/** Issues: Missed or Failed Posts. */
export function attentionSql(userId: number | typeof posts.userId, now: Date): SQL {
  return or(missedSql(userId, now), eq(posts.status, 'failed'))!;
}

export function postState(row: {
  status: PostStatus;
  missed: number;
  lastError: string | null;
}): PostState {
  const missed = row.missed === 1;
  return {
    missed,
    reason:
      row.status === 'failed'
        ? row.lastError !== null
          ? `publish failed: ${row.lastError}`
          : 'publish failed'
        : missed
          ? row.status === 'draft'
            ? 'time passed, still a draft'
            : 'time passed, no X account'
          : null,
    dismiss: row.status === 'failed' ? 'demote' : missed ? 'unschedule' : null,
  };
}
