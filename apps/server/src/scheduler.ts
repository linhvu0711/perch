import type { Clock } from './clock';
import type { Db } from './db';
import type { XClient } from './x/client';

export function createTick(_deps: {
  db: Db;
  clock: Clock;
  xClient: XClient;
}): (now: Date) => Promise<void> {
  // Publishing arrives in #10.
  return async () => {};
}
