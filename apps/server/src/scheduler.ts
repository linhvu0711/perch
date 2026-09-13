import type { Clock } from './clock';
import type { Db } from './db';
import type { XAccountService } from './x/accounts';
import type { XClient } from './x/client';

export function createTick(_deps: {
  db: Db;
  clock: Clock;
  xClient: XClient;
  accounts: XAccountService;
}): (now: Date) => Promise<void> {
  // Publishing arrives in #10.
  return async () => {};
}
