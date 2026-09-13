import type { Counts } from '@perch/core';
import { count, eq } from 'drizzle-orm';

import type { Db } from './index';
import { posts, resources } from './schema';

export function countAll(db: Db, userId: number): Counts {
  const postCount = db
    .select({ value: count() })
    .from(posts)
    .where(eq(posts.userId, userId))
    .get();
  const resourceCount = db
    .select({ value: count() })
    .from(resources)
    .where(eq(resources.userId, userId))
    .get();

  return { posts: postCount?.value ?? 0, resources: resourceCount?.value ?? 0 };
}
