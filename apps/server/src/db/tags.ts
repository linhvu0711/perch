import type { ItemTagsResponse, Tag, TagDeleteResponse, TagList } from '@perch/core';
import { and, count, eq, inArray } from 'drizzle-orm';

import type { Db } from './index';
import { TagExistsError } from './posts';
import { posts, postTags, resources, resourceTags, tags } from './schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function listTags(db: Db, userId: number): TagList {
  const rows = db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.userId, userId))
    .all();
  const resourceCounts = new Map(
    db
      .select({ tagId: resourceTags.tagId, total: count() })
      .from(resourceTags)
      .where(eq(resourceTags.userId, userId))
      .groupBy(resourceTags.tagId)
      .all()
      .map((row) => [row.tagId, row.total] as const),
  );
  const postCounts = new Map(
    db
      .select({ tagId: postTags.tagId, total: count() })
      .from(postTags)
      .where(eq(postTags.userId, userId))
      .groupBy(postTags.tagId)
      .all()
      .map((row) => [row.tagId, row.total] as const),
  );

  const items = rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      resource_count: resourceCounts.get(row.id) ?? 0,
      post_count: postCounts.get(row.id) ?? 0,
    }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  return { items, total: items.length, next_cursor: null };
}

export function createTag(db: Db, userId: number, name: string): Tag {
  const existing = db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.userId, userId))
    .all()
    .some((row) => row.name.toLowerCase() === name.toLowerCase());
  if (existing) throw new TagExistsError(name);

  const row = db.insert(tags).values({ userId, name }).returning().get();
  if (!row) throw new Error('tag insert failed');
  return { id: row.id, name: row.name, resource_count: 0, post_count: 0 };
}

export function tagsForResources(
  db: Db | Tx,
  userId: number,
  resourceIds: number[],
): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (resourceIds.length === 0) return result;

  const rows = db
    .select({ resourceId: resourceTags.resourceId, name: tags.name })
    .from(resourceTags)
    .innerJoin(tags, eq(resourceTags.tagId, tags.id))
    .where(and(eq(resourceTags.userId, userId), inArray(resourceTags.resourceId, resourceIds)))
    .all();

  for (const row of rows) {
    const list = result.get(row.resourceId) ?? [];
    list.push(row.name);
    result.set(row.resourceId, list);
  }
  for (const list of result.values()) {
    list.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }
  return result;
}

export function tagIdsByName(db: Db | Tx, userId: number): Map<string, number> {
  return new Map(
    db
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(eq(tags.userId, userId))
      .all()
      .map((row) => [row.name.toLowerCase(), row.id] as const),
  );
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
    tx.insert(resourceTags).values({ userId, resourceId, tagId }).onConflictDoNothing().run();
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
    .where(
      and(
        eq(resourceTags.userId, userId),
        eq(resourceTags.resourceId, resourceId),
        inArray(resourceTags.tagId, tagIds),
      ),
    )
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

function resourceExists(db: Db | Tx, userId: number, resourceId: number): boolean {
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
  return db.transaction((tx) => ({
    results: ids.map((id) => {
      if (!resourceExists(tx, userId, id)) {
        return {
          id,
          ok: false as const,
          error: { code: 'not_found', message: `Resource ${id} not found` },
        };
      }
      addResourceTags(tx, userId, id, names);
      return { id, ok: true as const, tags: tagsForResources(tx, userId, [id]).get(id) ?? [] };
    }),
  }));
}

export function untagResources(
  db: Db,
  userId: number,
  ids: number[],
  names: string[],
): ItemTagsResponse {
  return db.transaction((tx) => ({
    results: ids.map((id) => {
      if (!resourceExists(tx, userId, id)) {
        return {
          id,
          ok: false as const,
          error: { code: 'not_found', message: `Resource ${id} not found` },
        };
      }
      removeResourceTags(tx, userId, id, names);
      return { id, ok: true as const, tags: tagsForResources(tx, userId, [id]).get(id) ?? [] };
    }),
  }));
}

export function tagsForPosts(
  db: Db | Tx,
  userId: number,
  postIds: number[],
): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (postIds.length === 0) return result;

  const rows = db
    .select({ postId: postTags.postId, name: tags.name })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(and(eq(postTags.userId, userId), inArray(postTags.postId, postIds)))
    .all();

  for (const row of rows) {
    const list = result.get(row.postId) ?? [];
    list.push(row.name);
    result.set(row.postId, list);
  }
  for (const list of result.values()) {
    list.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }
  return result;
}

export function addPostTags(tx: Db | Tx, userId: number, postId: number, names: string[]): void {
  const tagIds = ensureTags(tx, userId, names);
  for (const tagId of tagIds.values()) {
    tx.insert(postTags).values({ userId, postId, tagId }).onConflictDoNothing().run();
  }
}

export function removePostTags(tx: Db | Tx, userId: number, postId: number, names: string[]): void {
  const tagIds = tagIdsForNames(tx, userId, names);
  if (tagIds.length === 0) return;
  tx.delete(postTags)
    .where(
      and(
        eq(postTags.userId, userId),
        eq(postTags.postId, postId),
        inArray(postTags.tagId, tagIds),
      ),
    )
    .run();
}

function postRowStatus(
  db: Db | Tx,
  userId: number,
  postId: number,
): { status: string } | 'not_found' {
  const row = db
    .select({ status: posts.status })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
    .get();
  return row ?? 'not_found';
}

export function tagPosts(db: Db, userId: number, ids: number[], names: string[]): ItemTagsResponse {
  return db.transaction((tx) => ({
    results: ids.map((id) => {
      const row = postRowStatus(tx, userId, id);
      if (row === 'not_found') {
        return {
          id,
          ok: false as const,
          error: { code: 'not_found', message: `Post ${id} not found` },
        };
      }
      if (row.status === 'published') {
        return {
          id,
          ok: false as const,
          error: { code: 'invalid_status', message: `Post ${id} is published` },
        };
      }
      addPostTags(tx, userId, id, names);
      return { id, ok: true as const, tags: tagsForPosts(tx, userId, [id]).get(id) ?? [] };
    }),
  }));
}

export function untagPosts(
  db: Db,
  userId: number,
  ids: number[],
  names: string[],
): ItemTagsResponse {
  return db.transaction((tx) => ({
    results: ids.map((id) => {
      const row = postRowStatus(tx, userId, id);
      if (row === 'not_found') {
        return {
          id,
          ok: false as const,
          error: { code: 'not_found', message: `Post ${id} not found` },
        };
      }
      if (row.status === 'published') {
        return {
          id,
          ok: false as const,
          error: { code: 'invalid_status', message: `Post ${id} is published` },
        };
      }
      removePostTags(tx, userId, id, names);
      return { id, ok: true as const, tags: tagsForPosts(tx, userId, [id]).get(id) ?? [] };
    }),
  }));
}

export function renameTag(db: Db, userId: number, id: number, name: string): Tag | null {
  const row = db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, userId)))
    .get();
  if (!row) return null;

  const conflict = db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.userId, userId))
    .all()
    .find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (conflict && conflict.id !== id) throw new TagExistsError(name);

  if (row.name !== name) db.update(tags).set({ name }).where(eq(tags.id, id)).run();
  return (
    listTags(db, userId).items.find((item) => item.id === id) ?? {
      id,
      name,
      resource_count: 0,
      post_count: 0,
    }
  );
}

export function deleteTags(db: Db, userId: number, ids: number[]): TagDeleteResponse {
  return {
    results: ids.map((id) => {
      const deleted = db
        .delete(tags)
        .where(and(eq(tags.id, id), eq(tags.userId, userId)))
        .returning({ id: tags.id })
        .get();

      return deleted
        ? { id, ok: true as const }
        : {
            id,
            ok: false as const,
            error: { code: 'not_found', message: `Tag ${id} not found` },
          };
    }),
  };
}
