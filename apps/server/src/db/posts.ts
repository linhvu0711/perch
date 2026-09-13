import {
  CHAR_LIMIT_DEFAULT,
  estimateCost,
  weightedLength,
  type Post,
  type PostCreate,
  type PostLink,
} from '@perch/core';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Db } from './index';
import { getSettings } from './settings';
import { postLinks, posts, resources } from './schema';

export class MissingResourceError extends Error {
  constructor(public resourceId: number) {
    super(`Resource ${resourceId} not found`);
  }
}

type PostRow = typeof posts.$inferSelect;

function toPost(row: PostRow, links: PostLink[], limit: number): Post {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    text: row.text,
    scheduled_at: row.scheduledAt?.toISOString() ?? null,
    published_at: row.publishedAt?.toISOString() ?? null,
    x_account_id: row.xAccountId,
    x_post_id: row.xPostId,
    last_error: row.lastError,
    retry_count: row.retryCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    character_count: weightedLength(row.text),
    limit,
    estimated_cost: estimateCost(row.text),
    links,
    media: [],
  };
}

function postLimit(db: Db, userId: number): number {
  return getSettings(db, userId).char_limit_override ?? CHAR_LIMIT_DEFAULT;
}

function linksForPosts(db: Db, postIds: number[]): Map<number, PostLink[]> {
  const result = new Map<number, PostLink[]>();
  if (postIds.length === 0) return result;

  const rows = db
    .select({
      postId: postLinks.postId,
      resourceId: postLinks.resourceId,
      type: resources.type,
      title: resources.title,
    })
    .from(postLinks)
    .innerJoin(resources, eq(postLinks.resourceId, resources.id))
    .where(inArray(postLinks.postId, postIds))
    .orderBy(asc(postLinks.resourceId))
    .all();

  for (const row of rows) {
    const list = result.get(row.postId) ?? [];
    list.push({ resource_id: row.resourceId, type: row.type, title: row.title });
    result.set(row.postId, list);
  }
  return result;
}

export function createPost(
  db: Db,
  userId: number,
  input: PostCreate,
  now: Date,
): Post {
  for (const resourceId of input.from ?? []) {
    const resource = db
      .select({ id: resources.id })
      .from(resources)
      .where(and(eq(resources.id, resourceId), eq(resources.userId, userId)))
      .get();
    if (!resource) throw new MissingResourceError(resourceId);
  }

  const row = db
    .insert(posts)
    .values({
      userId,
      status: 'draft',
      title: input.title ?? '',
      text: input.text ?? '',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  if (!row) throw new Error('post insert failed');

  for (const resourceId of input.from ?? []) {
    db.insert(postLinks)
      .values({ postId: row.id, resourceId })
      .onConflictDoNothing()
      .run();
  }

  const post = getPost(db, userId, row.id);
  if (!post) throw new Error('post insert failed');
  return post;
}

export function getPost(db: Db, userId: number, id: number): Post | null {
  const row = db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, userId)))
    .get();
  if (!row) return null;

  return toPost(row, linksForPosts(db, [row.id]).get(row.id) ?? [], postLimit(db, userId));
}
