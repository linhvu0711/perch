import type { ItemTagsResponse, Tag, TagList } from '@perch/core';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Db } from './index';
import { TagExistsError } from './posts';
import { resources, resourceTags, tags } from './schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

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

export function tagsForResources(db: Db | Tx, resourceIds: number[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (resourceIds.length === 0) return result;

  const rows = db
    .select({ resourceId: resourceTags.resourceId, name: tags.name })
    .from(resourceTags)
    .innerJoin(tags, eq(resourceTags.tagId, tags.id))
    .where(inArray(resourceTags.resourceId, resourceIds))
    .orderBy(sql`lower(${tags.name})`)
    .all();

  for (const row of rows) {
    const list = result.get(row.resourceId) ?? [];
    list.push(row.name);
    result.set(row.resourceId, list);
  }
  return result;
}

/** Finds each tag by lower(name), inserting the missing ones; keyed by name.toLowerCase(). */
export function ensureTags(tx: Db | Tx, userId: number, names: string[]): Map<string, number> {
  const wanted = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name !== '' && !wanted.has(name.toLowerCase())) wanted.set(name.toLowerCase(), name);
  }

  const result = new Map<string, number>();
  if (wanted.size === 0) return result;

  const existing = new Map(
    tx
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(eq(tags.userId, userId))
      .all()
      .map((row) => [row.name.toLowerCase(), row.id] as const),
  );

  for (const [key, name] of wanted) {
    const found = existing.get(key);
    if (found !== undefined) {
      result.set(key, found);
      continue;
    }
    const row = tx.insert(tags).values({ userId, name }).returning().get();
    if (!row) throw new Error('tag insert failed');
    existing.set(key, row.id);
    result.set(key, row.id);
  }
  return result;
}

export function addResourceTags(
  tx: Db | Tx,
  userId: number,
  resourceId: number,
  names: string[],
): void {
  const tagIds = ensureTags(tx, userId, names);
  for (const tagId of tagIds.values()) {
    tx.insert(resourceTags).values({ resourceId, tagId }).onConflictDoNothing().run();
  }
}

export function removeResourceTags(
  tx: Db | Tx,
  userId: number,
  resourceId: number,
  names: string[],
): void {
  const tagIds = tagIdsForNames(tx, userId, names);
  if (tagIds.length === 0) return;
  tx.delete(resourceTags)
    .where(and(eq(resourceTags.resourceId, resourceId), inArray(resourceTags.tagId, tagIds)))
    .run();
}

function tagIdsForNames(tx: Db | Tx, userId: number, names: string[]): number[] {
  const lowered = new Set(names.map((name) => name.trim().toLowerCase()));
  lowered.delete('');
  if (lowered.size === 0) return [];
  return tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.userId, userId))
    .all()
    .filter((row) => lowered.has(row.name.toLowerCase()))
    .map((row) => row.id);
}

function resourceExists(db: Db, userId: number, resourceId: number): boolean {
  return (
    db
      .select({ id: resources.id })
      .from(resources)
      .where(and(eq(resources.id, resourceId), eq(resources.userId, userId)))
      .get() !== undefined
  );
}

export function tagResources(
  db: Db,
  userId: number,
  ids: number[],
  names: string[],
): ItemTagsResponse {
  return {
    results: ids.map((id) => {
      if (!resourceExists(db, userId, id)) {
        return {
          id,
          ok: false as const,
          error: { code: 'not_found', message: `Resource ${id} not found` },
        };
      }
      addResourceTags(db, userId, id, names);
      return { id, ok: true as const, tags: tagsForResources(db, [id]).get(id) ?? [] };
    }),
  };
}

export function untagResources(
  db: Db,
  userId: number,
  ids: number[],
  names: string[],
): ItemTagsResponse {
  return {
    results: ids.map((id) => {
      if (!resourceExists(db, userId, id)) {
        return {
          id,
          ok: false as const,
          error: { code: 'not_found', message: `Resource ${id} not found` },
        };
      }
      removeResourceTags(db, userId, id, names);
      return { id, ok: true as const, tags: tagsForResources(db, [id]).get(id) ?? [] };
    }),
  };
}
