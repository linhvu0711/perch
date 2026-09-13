import type { Tag, TagList } from '@perch/core';
import { and, eq, sql } from 'drizzle-orm';

import type { Db } from './index';
import { postTags, resourceTags, tags } from './schema';
import { TagExistsError } from './posts';

export function listTags(db: Db, userId: number): TagList {
  const items = db
    .select({
      id: tags.id,
      name: tags.name,
      resource_count: sql<number>`(select count(*) from resource_tags where resource_tags.tag_id = ${tags.id})`,
      post_count: sql<number>`(select count(*) from post_tags where post_tags.tag_id = ${tags.id})`,
    })
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(sql`lower(${tags.name})`)
    .all();

  return { items, total: items.length, next_cursor: null };
}

export function createTag(db: Db, userId: number, name: string): Tag {
  const existing = db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), sql`lower(${tags.name}) = lower(${name})`))
    .get();
  if (existing) throw new TagExistsError(name);

  const row = db.insert(tags).values({ userId, name }).returning().get();
  if (!row) throw new Error('tag insert failed');
  return { id: row.id, name: row.name, resource_count: 0, post_count: 0 };
}
