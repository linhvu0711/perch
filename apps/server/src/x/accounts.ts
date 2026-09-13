import {
  type AccountStatus,
  type ConnectStart,
  effectiveCharLimit,
  X_COSTS_USD,
  X_ENDPOINTS,
} from '@perch/core';

import type { Clock } from '../clock';
import type { Db } from '../db';
import { logApiCall } from '../db/apiCalls';
import { getSettings } from '../db/settings';
import {
  accountsDueForRefresh,
  connectAccount,
  disconnectAccount,
  getConnectedAccount,
  markReconnectRequired,
  storeRefreshedTokens,
  toXAccount,
  type XAccountRow,
} from '../db/xAccounts';
import { ApiError } from '../errors';
import { type XClient, XError, type XMe, type XTokens } from './client';
import { buildAuthorizeUrl, createPkce, createStateStore, type XOAuthConfig } from './oauth';

export interface XAccountService {
  status(userId: number): AccountStatus;
  startConnect(userId: number): ConnectStart;
  completeConnect(input: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<{ ok: true } | { ok: false; reason: 'denied' | 'expired' | 'failed' }>;
  refreshDue(now: Date): Promise<void>;
  accessTokenFor(userId: number): Promise<{ account: XAccountRow; accessToken: string }>;
  disconnect(userId: number): Promise<AccountStatus>;
}

export const REFRESH_MARGIN_MS = 10 * 60_000;

export function createXAccountService(deps: {
  db: Db;
  clock: Clock;
  xClient: XClient;
  xOAuth: XOAuthConfig | null;
}): XAccountService {
  const states = createStateStore(deps.clock);
  const inFlightRefreshes = new Map<number, Promise<void>>();

  return {
    status(userId) {
      const row = getConnectedAccount(deps.db, userId);
      const settings = getSettings(deps.db, userId);
      return {
        account: row ? toXAccount(row) : null,
        char_limit: effectiveCharLimit(settings.char_limit_override, row?.subscriptionType ?? null),
      };
    },

    startConnect(userId) {
      if (!deps.xOAuth) {
        throw new ApiError(
          503,
          'not_configured',
          'X OAuth is not configured. Set PERCH_X_CLIENT_ID and PERCH_X_CLIENT_SECRET.',
        );
      }
      const pkce = createPkce();
      const state = states.put({
        userId,
        codeVerifier: pkce.codeVerifier,
      });
      return {
        authorize_url: buildAuthorizeUrl(deps.xOAuth, {
          state,
          codeChallenge: pkce.codeChallenge,
        }),
      };
    },

    async completeConnect(input) {
      const entry = input.state ? states.take(input.state) : null;
      if (!entry) return { ok: false, reason: 'expired' };
      if (input.error || !input.code) return { ok: false, reason: 'denied' };

      let tokens: XTokens;
      let me: XMe;
      try {
        tokens = await deps.xClient.exchangeCode({
          code: input.code,
          codeVerifier: entry.codeVerifier,
          redirectUri: deps.xOAuth!.redirectUri,
        });
        me = await deps.xClient.getMe(tokens.accessToken);
      } catch (error) {
        console.error(error);
        return { ok: false, reason: 'failed' };
      }

      const now = deps.clock.now();
      const { replacedTokens } = deps.db.transaction((tx) => {
        const result = connectAccount(tx, entry.userId, {
          xUserId: me.id,
          username: me.username,
          subscriptionType: me.subscriptionType,
          tokens,
          now,
        });
        logApiCall(tx, entry.userId, {
          endpoint: X_ENDPOINTS.getMe,
          costUsd: X_COSTS_USD.getMe,
          xAccountId: result.account.id,
          now,
        });
        return result;
      });

      for (const replaced of replacedTokens) {
        try {
          await deps.xClient.revokeToken(replaced.refreshToken);
        } catch (error) {
          console.error(error);
        }
        try {
          await deps.xClient.revokeToken(replaced.accessToken);
        } catch (error) {
          console.error(error);
        }
      }

      return { ok: true };
    },

    async refreshDue(now) {
      const due = accountsDueForRefresh(deps.db, new Date(now.getTime() + REFRESH_MARGIN_MS));
      for (const row of due) {
        await refreshRow(row);
      }
    },

    async accessTokenFor(userId) {
      let row = getConnectedAccount(deps.db, userId);
      if (!row) {
        throw new ApiError(404, 'not_found', 'No X account connected');
      }
      if (row.reconnectRequired) {
        throw new ApiError(409, 'reconnect_required', 'X account needs to be reconnected');
      }
      if (row.expiresAt.getTime() <= deps.clock.now().getTime() + REFRESH_MARGIN_MS) {
        await refreshRow(row);
        const fresh = getConnectedAccount(deps.db, userId);
        if (!fresh || fresh.reconnectRequired) {
          throw new ApiError(409, 'reconnect_required', 'X account needs to be reconnected');
        }
        if (fresh.expiresAt.getTime() <= deps.clock.now().getTime() + REFRESH_MARGIN_MS) {
          throw new ApiError(503, 'token_refresh_failed', 'X token refresh failed');
        }
        row = fresh;
      }
      return { account: row, accessToken: row.accessToken };
    },

    async disconnect(userId) {
      const row = getConnectedAccount(deps.db, userId);
      if (!row) {
        throw new ApiError(404, 'not_found', 'No X account connected');
      }
      let refreshToken = row.refreshToken;
      let accessToken = row.accessToken;
      if (!row.reconnectRequired) {
        try {
          const fresh = await this.accessTokenFor(userId);
          refreshToken = fresh.account.refreshToken;
          accessToken = fresh.accessToken;
        } catch (error) {
          if (!(error instanceof ApiError && error.code === 'token_refresh_failed')) {
            throw error;
          }
        }
      }
      try {
        await deps.xClient.revokeToken(refreshToken);
      } catch (error) {
        console.error(error);
      }
      try {
        await deps.xClient.revokeToken(accessToken);
      } catch (error) {
        console.error(error);
      }
      disconnectAccount(deps.db, row.id, deps.clock.now());
      return this.status(userId);
    },
  };

  function refreshRow(row: XAccountRow): Promise<void> {
    const inFlight = inFlightRefreshes.get(row.id);
    if (inFlight) return inFlight;
    const pending = (async () => {
      try {
        const tokens = await deps.xClient.refreshToken(row.refreshToken);
        storeRefreshedTokens(deps.db, row.id, tokens, deps.clock.now());
      } catch (error) {
        if (error instanceof XError && error.kind === 'invalid_grant') {
          markReconnectRequired(deps.db, row.id);
          return;
        }
        console.error(error);
      }
    })().finally(() => inFlightRefreshes.delete(row.id));
    inFlightRefreshes.set(row.id, pending);
    return pending;
  }
}
