import { STATUS_NEXT_DUE, STATUS_WEEK_MS, type Status } from '@perch/core';
import { and, count, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';

import { monthCostUsd } from './apiCalls';
import type { Db } from './index';
import { missedSql } from './postState';
import { upcomingPosts } from './posts';
import { posts } from './schema';
import { getConnectedAccount, toXAccount } from './xAccounts';

function countWhere(db: Db, condition: SQL): number {
  return db.select({ value: count() }).from(posts).where(condition).get()?.value ?? 0;
}

/** The one-call picture behind the Dashboard and `perch status`. */
export function statusSnapshot(db: Db, userId: number, timeZone: string, now: Date): Status {
  const account = getConnectedAccount(db, userId);
  const week = and(
    eq(posts.userId, userId),
    inArray(posts.status, ['draft', 'official']),
    gte(posts.scheduledAt, now),
    lt(posts.scheduledAt, new Date(now.getTime() + STATUS_WEEK_MS)),
  )!;
  return {
    timezone: timeZone,
    account: account !== null ? toXAccount(account) : null,
    next_due: upcomingPosts(db, userId, now, { limit: STATUS_NEXT_DUE }),
    next_official: upcomingPosts(db, userId, now, { official: true, limit: 1 })[0] ?? null,
    missed_count: countWhere(db, and(eq(posts.userId, userId), missedSql(userId, now))!),
    failed_count: countWhere(db, and(eq(posts.userId, userId), eq(posts.status, 'failed'))!),
    week_official_count: countWhere(db, and(week, eq(posts.status, 'official'))!),
    week_draft_count: countWhere(db, and(week, eq(posts.status, 'draft'))!),
    month_cost_usd: monthCostUsd(db, userId, timeZone, now),
  };
}
