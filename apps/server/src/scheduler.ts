import type { PostLifecycle } from './postLifecycle';
import type { XAccountService } from './x/accounts';

export function createTick(deps: {
  accounts: XAccountService;
  lifecycle: PostLifecycle;
}): (now: Date) => Promise<void> {
  return async (now) => {
    await deps.accounts.refreshDue(now);
    await deps.lifecycle.sendDue(now);
  };
}
