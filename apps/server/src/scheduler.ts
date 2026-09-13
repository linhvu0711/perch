import type { Clock } from './clock';
import type { Db } from './db';
import type { XAccountService } from './x/accounts';
import type { XClient } from './x/client';
import type { PublishService } from './x/publish';

export function createTick(deps: {
  db: Db;
  clock: Clock;
  xClient: XClient;
  accounts: XAccountService;
  publisher: PublishService;
}): (now: Date) => Promise<void> {
  return async (now) => {
    await deps.accounts.refreshDue(now);
    await deps.publisher.sendDue(now);
  };
}
