import {
  type CostHistory,
  type CostHistoryQuery,
  type CostMonth,
  type CostMonthRow,
  type CostSummary,
  costKindOf,
  zonedParts,
} from '@perch/core';
import { and, desc, eq, gte } from 'drizzle-orm';

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
export function costMonths(
  db: Db,
  userId: number,
  timeZone: string,
  options: { from?: Date } = {},
): CostMonthRow[] {
  const conditions = [eq(apiCalls.userId, userId)];
  if (options.from !== undefined) conditions.push(gte(apiCalls.createdAt, options.from));
  const rows = db
    .select({
      endpoint: apiCalls.endpoint,
      costUsd: apiCalls.costUsd,
      createdAt: apiCalls.createdAt,
    })
    .from(apiCalls)
    .where(and(...conditions))
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
export function costSummary(db: Db, userId: number, month: string, timeZone: string,
): CostSummary {
  const all = db
    .select({ costUsd: apiCalls.costUsd, endpoint: apiCalls.endpoint })
    .from(apiCalls)
    .where(eq(apiCalls.userId, userId))
    .all();
  let allTimeRaw = 0;
  for (const call of all) {
    try {
      costKindOf(call.endpoint);
      allTimeRaw += call.costUsd;
    } catch {
    }
  }
  const rows = costMonths(db, userId, timeZone);
  const row = rows.find((item) => item.month === month) ?? emptyMonthRow(month as CostMonth);
  return { ...row, all_time_usd: roundUsd(allTimeRaw) };
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

// Longest possible month span plus the worst zone offsets: anything older cannot
// fall inside the current month, so status polls only scan recent rows.
const MONTH_COST_LOOKBACK_MS = 34 * 86_400_000;

/** USD cost of the calendar month containing `now` in `timeZone`. */
export function monthCostUsd(db: Db, userId: number, timeZone: string, now: Date): number {
  const month = zonedParts(now, timeZone).date.slice(0, 7);
  const rows = costMonths(db, userId, timeZone, {
    from: new Date(now.getTime() - MONTH_COST_LOOKBACK_MS),
  });
  return rows.find((row) => row.month === month)?.total_usd ?? 0;
}
