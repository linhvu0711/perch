import { and, eq, gte, sql } from 'drizzle-orm';

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

export function monthCostUsd(db: Db, userId: number, now: Date): number {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const row = db
    .select({ total: sql<number>`coalesce(sum(${apiCalls.costUsd}), 0)` })
    .from(apiCalls)
    .where(and(eq(apiCalls.userId, userId), gte(apiCalls.createdAt, monthStart)))
    .get();

  return Math.round((row?.total ?? 0) * 1000) / 1000;
}
