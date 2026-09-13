import {
  effectiveCharLimit,
  type AccountStatus,
} from '@perch/core';

import type { Clock } from '../clock';
import type { Db } from '../db';
import { getSettings } from '../db/settings';
import { getConnectedAccount, toXAccount } from '../db/xAccounts';
import type { XClient } from './client';
import type { XOAuthConfig } from './oauth';

export interface XAccountService {
  status(userId: number): AccountStatus;
}

export function createXAccountService(deps: {
  db: Db;
  clock: Clock;
  xClient: XClient;
  xOAuth: XOAuthConfig | null;
}): XAccountService {
  return {
    status(userId) {
      const row = getConnectedAccount(deps.db, userId);
      const settings = getSettings(deps.db, userId);
      return {
        account: row ? toXAccount(row) : null,
        char_limit: effectiveCharLimit(
          settings.char_limit_override,
          row?.subscriptionType ?? null,
        ),
      };
    },
  };
}
