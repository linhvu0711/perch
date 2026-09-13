import type { XAccount } from '@perch/core';
import { and, eq, isNull, lte, ne } from 'drizzle-orm';

import type { XTokens } from '../x/client';
import type { Db } from './index';
import { xAccounts } from './schema';

export type XAccountRow = typeof xAccounts.$inferSelect;

export function toXAccount(row: XAccountRow): XAccount {
  return {
    id: row.id,
    x_user_id: row.xUserId,
    username: row.username,
    subscription_type: row.subscriptionType,
    connected_at: row.connectedAt.toISOString(),
    reconnect_required: row.reconnectRequired,
  };
}

export function getConnectedAccount(db: Db, userId: number): XAccountRow | null {
  const row = db
    .select()
    .from(xAccounts)
    .where(and(eq(xAccounts.userId, userId), isNull(xAccounts.disconnectedAt)))
    .get();

  return row ?? null;
}

export function connectAccount(
  db: Db,
  userId: number,
  input: {
    xUserId: string;
    username: string;
    subscriptionType: string;
    tokens: XTokens;
    now: Date;
  },
): { account: XAccountRow; replacedTokens: XTokens[] } {
  return db.transaction((tx) => {
    const replaced = tx
      .select()
      .from(xAccounts)
      .where(
        and(
          eq(xAccounts.userId, userId),
          isNull(xAccounts.disconnectedAt),
          ne(xAccounts.xUserId, input.xUserId),
        ),
      )
      .all();

    for (const row of replaced) {
      tx.update(xAccounts).set({ disconnectedAt: input.now }).where(eq(xAccounts.id, row.id)).run();
    }

    const expiresAt = new Date(input.now.getTime() + input.tokens.expiresIn * 1000);
    const existing = tx
      .select()
      .from(xAccounts)
      .where(and(eq(xAccounts.userId, userId), eq(xAccounts.xUserId, input.xUserId)))
      .get();

    const account = existing
      ? tx
          .update(xAccounts)
          .set({
            username: input.username,
            subscriptionType: input.subscriptionType,
            accessToken: input.tokens.accessToken,
            refreshToken: input.tokens.refreshToken,
            expiresAt,
            connectedAt: input.now,
            disconnectedAt: null,
            reconnectRequired: false,
          })
          .where(eq(xAccounts.id, existing.id))
          .returning()
          .get()
      : tx
          .insert(xAccounts)
          .values({
            userId,
            xUserId: input.xUserId,
            username: input.username,
            subscriptionType: input.subscriptionType,
            accessToken: input.tokens.accessToken,
            refreshToken: input.tokens.refreshToken,
            expiresAt,
            connectedAt: input.now,
          })
          .returning()
          .get();

    if (!account) throw new Error('x account upsert failed');

    return {
      account,
      replacedTokens: replaced.map((row) => ({
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        expiresIn: 0,
        scope: '',
      })),
    };
  });
}

export function storeRefreshedTokens(db: Db, id: number, tokens: XTokens, now: Date): void {
  db.update(xAccounts)
    .set({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
      reconnectRequired: false,
    })
    .where(and(eq(xAccounts.id, id), isNull(xAccounts.disconnectedAt)))
    .run();
}

export function markReconnectRequired(db: Db, id: number): void {
  db.update(xAccounts).set({ reconnectRequired: true }).where(eq(xAccounts.id, id)).run();
}

export function disconnectAccount(db: Db, id: number, now: Date): void {
  db.update(xAccounts).set({ disconnectedAt: now }).where(eq(xAccounts.id, id)).run();
}

export function accountsDueForRefresh(db: Db, before: Date): XAccountRow[] {
  return db
    .select()
    .from(xAccounts)
    .where(
      and(
        isNull(xAccounts.disconnectedAt),
        eq(xAccounts.reconnectRequired, false),
        lte(xAccounts.expiresAt, before),
      ),
    )
    .all();
}
