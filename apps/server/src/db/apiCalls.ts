import {
  type CostHistory,
  type CostHistoryQuery,
  type CostMonth,
  type CostMonthRow,
  type CostSummary,
  costKindOf,
  zonedParts,
} from '@perch/core';
import { desc, eq } from 'drizzle-orm';

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

/** Per-month cost totals keyed by the calendar month in `timeZone`, newest first. */
export function costMonths(db: Db, userId: number, timeZone: string): CostMonthRow[] {
  const rows = db
    .select({
      endpoint: apiCalls.endpoint,
      costUsd: apiCalls.costUsd,
      createdAt: apiCalls.createdAt,
    })
    .from(apiCalls)
    .where(eq(apiCalls.userId, userId))
    .orderBy(desc(apiCalls.createdAt))
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

  return [...byMonth.values()]
    .map((row) => ({
      ...row,
      publish_usd: roundUsd(row.publish_usd),
      save_tweet_usd: roundUsd(row.save_tweet_usd),
      connect_usd: roundUsd(row.connect_usd),
      total_usd: roundUsd(row.total_usd),
    }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));
}

/** The `costMonths` row for `month` (zeros when absent) plus the all-time total. */
export function costSummary(db: Db, userId: number, month: string, timeZone: string): CostSummary {
  const rows = costMonths(db, userId, timeZone);
  const row = rows.find((item) => item.month === month) ?? emptyMonthRow(month as CostMonth);
  const allTime = roundUsd(rows.reduce((sum, item) => sum + item.total_usd, 0));
  return { ...row, all_time_usd: allTime };
}

/** `costMonths` cut to the rows after the cursor month, paged at `limit`. */
export function costHistory(
  db: Db,
  userId: number,
  query: CostHistoryQuery,
  timeZone: string,
): CostHistory | null {
  const after = query.cursor === undefined ? null : decodeMonthCursor(query.cursor);
  if (query.cursor !== undefined && after === null) return null;

  const rows = costMonths(db, userId, timeZone);
  const page = rows.filter((row) => after === null || row.month < after);
  const items = page.slice(0, query.limit);
  const last = items[items.length - 1];

  return {
    items,
    total: rows.length,
    next_cursor:
      last !== undefined && page.length > query.limit ? encodeMonthCursor(last.month) : null,
  };
}

/** USD cost of the calendar month containing `now` in `timeZone`. */
export function monthCostUsd(db: Db, userId: number, timeZone: string, now: Date): number {
  return costSummary(db, userId, zonedParts(now, timeZone).date.slice(0, 7), timeZone).total_usd;
}
