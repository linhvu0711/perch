import {
  type CostHistory,
  type CostMonth,
  type CostMonthRow,
  type CostSummary,
  costKindOf,
  zonedParts,
} from '@perch/core';
import { asc, eq } from 'drizzle-orm';

import { decodeMonthCursor, encodeMonthCursor } from './cursor';
import type { Db } from './index';
import { apiCalls } from './schema';

export function logApiCall(
  db: Db,
  userId: number,
  input: {
    endpoint: string;
    costUsd: number;
    postId?: number;
    resourceId?: number;
    xAccountId?: number;
    now: Date;
  },
): void {
  db.insert(apiCalls)
    .values({
      userId,
      endpoint: input.endpoint,
      costUsd: input.costUsd,
      postId: input.postId ?? null,
      resourceId: input.resourceId ?? null,
      xAccountId: input.xAccountId ?? null,
      createdAt: input.now,
    })
    .run();
}

function roundUsd(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function emptyMonthRow(month: CostMonth): CostMonthRow {
  return { month, calls: 0, publish_usd: 0, save_tweet_usd: 0, connect_usd: 0, total_usd: 0 };
}

function monthRows(db: Db, userId: number, timeZone: string): CostMonthRow[] {
  const rows = db
    .select({
      endpoint: apiCalls.endpoint,
      costUsd: apiCalls.costUsd,
      createdAt: apiCalls.createdAt,
    })
    .from(apiCalls)
    .where(eq(apiCalls.userId, userId))
    .orderBy(asc(apiCalls.createdAt))
    .all();

  const byMonth = new Map<CostMonth, CostMonthRow>();
  for (const row of rows) {
    let kind: 'publish' | 'save_tweet' | 'connect';
    try {
      kind = costKindOf(row.endpoint);
    } catch {
      continue;
    }
    const month = zonedParts(row.createdAt, timeZone).date.slice(0, 7) as CostMonth;
    const bucket = byMonth.get(month) ?? emptyMonthRow(month);
    bucket.calls += 1;
    bucket[`${kind}_usd`] += row.costUsd;
    bucket.total_usd += row.costUsd;
    byMonth.set(month, bucket);
  }

  return [...byMonth.values()].map((row) => ({
    ...row,
    publish_usd: roundUsd(row.publish_usd),
    save_tweet_usd: roundUsd(row.save_tweet_usd),
    connect_usd: roundUsd(row.connect_usd),
    total_usd: roundUsd(row.total_usd),
  }));
}

/** USD cost for the calendar month containing `now` in `timeZone`. */
export function monthCostUsd(db: Db, userId: number, timeZone: string, now: Date): number {
  const month = zonedParts(now, timeZone).date.slice(0, 7);
  const row = monthRows(db, userId, timeZone).find((item) => item.month === month);
  return row?.total_usd ?? 0;
}

/** Per-month cost totals for the requested month (the current month by default). */
export function costSummary(
  db: Db,
  userId: number,
  timeZone: string,
  now: Date,
  month?: CostMonth,
): CostSummary {
  const wanted = month ?? (zonedParts(now, timeZone).date.slice(0, 7) as CostMonth);
  const rows = monthRows(db, userId, timeZone);
  const row = rows.find((item) => item.month === wanted) ?? emptyMonthRow(wanted);
  const allTime = roundUsd(rows.reduce((sum, item) => sum + item.total_usd, 0));
  return { ...row, all_time_usd: allTime };
}

/** Months with known-endpoint calls, newest first, paged by month cursor. */
export function costHistory(
  db: Db,
  userId: number,
  timeZone: string,
  query: { limit: number; cursor?: string },
): CostHistory | null {
  const after = query.cursor === undefined ? null : decodeMonthCursor(query.cursor);
  if (query.cursor !== undefined && after === null) return null;

  const rows = monthRows(db, userId, timeZone);
  const months = rows
    .map((row) => row.month)
    .sort()
    .reverse();
  const page = months.filter((month) => after === null || month < after);
  const items = page.slice(0, query.limit);
  const hasMore = page.length > query.limit;
  const last = items[items.length - 1];
  const byMonth = new Map(rows.map((row) => [row.month, row] as const));

  return {
    items: items.map((month) => byMonth.get(month) ?? emptyMonthRow(month)),
    total: months.length,
    next_cursor: hasMore && last !== undefined ? encodeMonthCursor(last) : null,
  };
}
