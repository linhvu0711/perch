import {
  DEMOTE_FROM,
  dayBoundsUtc,
  effectiveCharLimit,
  estimateCost,
  POST_MEDIA_MAX,
  type Post,
  type PostCreate,
  type PostDeleteResponse,
  type PostLink,
  type PostLinksResponse,
  type PostList,
  type PostListQuery,
  type PostMedia,
  type PostPatch,
  type PostPreview,
  type PostScheduleBody,
  type PostStatus,
  type PostStatusResponse,
  PROMOTE_FROM,
  parseScheduleTime,
  postListTitle,
  previewSegments,
  promoteChecks,
  type Ready,
  readyChecks,
  SCHEDULE_FROM,
  weightedLength,
} from '@perch/core';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import { decodePostCursor, encodePostCursor } from './cursor';
import type { Db } from './index';
import { type MediaFiles, mediaForPosts } from './postMedia';
import { postLinks, postMedia, posts, postTags, resources, xAccounts } from './schema';
import { getSettings } from './settings';
import { addPostTags, tagIdsByName, tagsForPosts, tagsForResources } from './tags';
import { getConnectedAccount } from './xAccounts';

export class InvalidPostCursorError extends Error {}

export class PostImmutableError extends Error {
  constructor(public postId: number) {
    super(`Post ${postId} is published`);
  }
}

export class MediaLimitError extends Error {
  constructor(public path: 'resource_ids' | 'files' | 'from') {
    super('At most 4 media per post');
  }
}

export class MissingResourceError extends Error {
  constructor(public resourceId: number) {
    super(`Resource ${resourceId} not found`);
  }
}

export class PostNotReadyError extends Error {
  constructor(public errors: Array<{ path: string; message: string }>) {
    super('Post is not ready');
  }
}

export class PostStatusError extends Error {
  constructor(
    public postId: number,
    status: PostStatus,
  ) {
    super(`Post ${postId} is ${status}`);
  }
}

export class ScheduleTimeError extends Error {}

export class TagExistsError extends Error {
  constructor(public tagName: string) {
    super(`Tag "${tagName}" already exists`);
  }
}

type PostRow = typeof posts.$inferSelect;
type PostJoinRow = PostRow & { username: string | null; missed: number };

function toPost(
  row: PostJoinRow,
  links: PostLink[],
  media: PostMedia[],
  limit: number,
  tags: string[],
  ready: Ready,
): Post {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    text: row.text,
    scheduled_at: row.scheduledAt?.toISOString() ?? null,
    published_at: row.publishedAt?.toISOString() ?? null,
    x_account_id: row.xAccountId,
    x_post_id: row.xPostId,
    x_post_url:
      row.username !== null && row.xPostId !== null
        ? `https://x.com/${row.username}/status/${row.xPostId}`
        : null,
    last_error: row.lastError,
    retry_count: row.retryCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    character_count: weightedLength(row.text),
    limit,
    estimated_cost: estimateCost(row.text),
    links,
    tags,
    media,
    ready,
    missed: row.missed === 1,
  };
}

function postLimit(db: Db, userId: number): number {
  return effectiveCharLimit(
    getSettings(db, userId).char_limit_override,
    getConnectedAccount(db, userId)?.subscriptionType ?? null,
  );
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

export async function createPost(
  db: Db,
  userId: number,
  input: PostCreate,
  now: Date,
  files?: MediaFiles,
): Promise<Post> {
  const fromResources = (input.from ?? []).map((resourceId) => {
    const resource = db
      .select()
      .from(resources)
      .where(and(eq(resources.id, resourceId), eq(resources.userId, userId)))
      .get();
    if (!resource) throw new MissingResourceError(resourceId);
    return resource;
  });

  const imageSources = fromResources.filter(
    (resource) => resource.type === 'image' && resource.imagePath,
  );
  if (imageSources.length > POST_MEDIA_MAX) throw new MediaLimitError('from');

  if (input.official) {
    const checks = promoteChecks({
      text: input.text ?? '',
      limit: postLimit(db, userId),
      media: [],
    });
    if (checks.length > 0) throw new PostNotReadyError(checks);
  }

  const row = db.transaction((tx) => {
    const inserted = tx
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
    if (!inserted) throw new Error('post insert failed');

    for (const resourceId of input.from ?? []) {
      tx.insert(postLinks).values({ postId: inserted.id, resourceId }).onConflictDoNothing().run();
    }
    addPostTags(tx, userId, inserted.id, [
      ...(input.tags ?? []),
      ...[...tagsForResources(tx, userId, input.from ?? []).values()].flat(),
    ]);
    return inserted;
  });

  if (files) {
    let position = 1;
    for (const resource of imageSources) {
      const bytes = await files.read(resource.imagePath!);
      if (!bytes) continue;
      const ext = resource.imagePath!.split('.').pop() ?? 'png';
      const rel = await files.store(row.id, bytes, ext);
      db.insert(postMedia)
        .values({
          postId: row.id,
          position: position++,
          path: rel,
          mime: resource.imageMime ?? 'image/png',
          bytes: bytes.length,
          fromResourceId: resource.id,
        })
        .run();
    }
  }

  if (input.official) {
    db.update(posts)
      .set({ status: 'official', updatedAt: now })
      .where(and(eq(posts.id, row.id), eq(posts.userId, userId)))
      .run();
  }

  const post = getPost(db, userId, row.id, now);
  if (!post) throw new Error('post insert failed');
  return post;
}

export function getPost(db: Db, userId: number, id: number, now: Date): Post | null {
  const row = db
    .select({
      ...getTableColumns(posts),
      username: xAccounts.username,
      missed: sql<number>`${missedSql(userId, now)}`,
    })
    .from(posts)
    .leftJoin(xAccounts, eq(xAccounts.id, posts.xAccountId))
    .where(and(eq(posts.id, id), eq(posts.userId, userId)))
    .get();
  if (!row) return null;

  const limit = postLimit(db, userId);
  const media = mediaForPosts(db, [row.id]).get(row.id) ?? [];
  return toPost(
    row,
    linksForPosts(db, [row.id]).get(row.id) ?? [],
    media,
    limit,
    tagsForPosts(db, userId, [row.id]).get(row.id) ?? [],
    readyChecks({
      text: row.text,
      limit,
      mediaCount: media.length,
      accountConnected: getConnectedAccount(db, userId) !== null,
    }),
  );
}

export function listPosts(
  db: Db,
  userId: number,
  query: PostListQuery,
  timeZone: string,
  now: Date,
): PostList {
  const sortTime = sql`CASE WHEN ${posts.status} = 'published' THEN ${posts.publishedAt} ELSE ${posts.scheduledAt} END`;

  const filterConditions: SQL[] = [eq(posts.userId, userId)];
  if (query.status !== undefined) filterConditions.push(eq(posts.status, query.status));
  if (query.search) {
    const escaped = query.search.replace(/[\\%_]/g, '\\$&');
    const pattern = `%${escaped}%`;
    filterConditions.push(
      or(
        sql`${posts.title} LIKE ${pattern} ESCAPE '\\'`,
        sql`${posts.text} LIKE ${pattern} ESCAPE '\\'`,
      )!,
    );
  }
  if (query.from !== undefined) {
    filterConditions.push(
      sql`${sortTime} >= ${dayBoundsUtc(query.from, timeZone).start.getTime()}`,
    );
  }
  if (query.to !== undefined) {
    filterConditions.push(sql`${sortTime} <= ${dayBoundsUtc(query.to, timeZone).end.getTime()}`);
  }
  if (query.scheduled !== undefined) {
    filterConditions.push(
      query.scheduled ? isNotNull(posts.scheduledAt) : isNull(posts.scheduledAt),
    );
  }
  if (query.missed !== undefined) {
    const condition = missedSql(userId, now);
    filterConditions.push(query.missed ? condition : not(sql`(${condition})`));
  }
  if (query.resource_id !== undefined) {
    filterConditions.push(
      sql`EXISTS (select 1 from post_links where post_links.post_id = ${posts.id} and post_links.resource_id = ${query.resource_id})`,
    );
  }
  const tagNames = query.tag ?? [];
  if (tagNames.length > 0) {
    const byName = tagIdsByName(db, userId);
    for (const name of tagNames) {
      const tagId = byName.get(name.toLowerCase());
      filterConditions.push(
        tagId === undefined
          ? inArray(posts.id, [])
          : inArray(
              posts.id,
              db
                .select({ postId: postTags.postId })
                .from(postTags)
                .where(and(eq(postTags.userId, userId), eq(postTags.tagId, tagId))),
            ),
      );
    }
  }

  const totalRow = db
    .select({ value: count() })
    .from(posts)
    .where(and(...filterConditions))
    .get();
  const pageConditions = [...filterConditions];

  if (query.cursor !== undefined) {
    const key = decodePostCursor(query.cursor);
    if (!key) throw new InvalidPostCursorError();

    pageConditions.push(
      key.time === null
        ? sql`${sortTime} IS NULL AND ${posts.id} < ${key.id}`
        : or(
            sql`${sortTime} < ${key.time}`,
            sql`${sortTime} = ${key.time} AND ${posts.id} < ${key.id}`,
            sql`${sortTime} IS NULL`,
          )!,
    );
  }

  const rows = db
    .select({
      ...getTableColumns(posts),
      username: xAccounts.username,
      missed: sql<number>`${missedSql(userId, now)}`,
    })
    .from(posts)
    .leftJoin(xAccounts, eq(xAccounts.id, posts.xAccountId))
    .where(and(...pageConditions))
    .orderBy(sql`${sortTime} IS NULL`, desc(sortTime), desc(posts.id))
    .limit(query.limit + 1)
    .all();

  const hasNextPage = rows.length > query.limit;
  const pageRows = hasNextPage ? rows.slice(0, query.limit) : rows;
  const last = pageRows.at(-1);

  const limit = postLimit(db, userId);
  const accountConnected = getConnectedAccount(db, userId) !== null;
  const postIds = pageRows.map((row) => row.id);
  const links = linksForPosts(db, postIds);
  const media = mediaForPosts(db, postIds);
  const postTagsMap = tagsForPosts(db, userId, postIds);
  const items = pageRows.map((row) => {
    const postMedia = media.get(row.id) ?? [];
    const post = toPost(
      row,
      links.get(row.id) ?? [],
      postMedia,
      limit,
      postTagsMap.get(row.id) ?? [],
      readyChecks({
        text: row.text,
        limit,
        mediaCount: postMedia.length,
        accountConnected,
      }),
    );
    return { ...post, title: postListTitle(post.title, post.text) };
  });

  const sortTimeOf = (row: PostRow): number | null => {
    const value = row.status === 'published' ? row.publishedAt : row.scheduledAt;
    return value === null ? null : value.getTime();
  };

  return {
    items,
    total: totalRow?.value ?? 0,
    next_cursor:
      hasNextPage && last ? encodePostCursor({ time: sortTimeOf(last), id: last.id }) : null,
  };
}

export function updatePost(
  db: Db,
  userId: number,
  id: number,
  patch: PostPatch,
  now: Date,
): Post | null {
  const current = getPostRow(db, userId, id);
  if (!current) return null;
  if (current.status === 'published') throw new PostImmutableError(id);

  db.update(posts)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      updatedAt: now,
    })
    .where(and(eq(posts.id, id), eq(posts.userId, userId)))
    .run();

  return getPost(db, userId, id, now);
}

export function getPostRow(db: Db, userId: number, id: number): PostRow | undefined {
  return db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, userId)))
    .get();
}

function accountConnectedAtSql(userId: number | typeof posts.userId, at: SQL): SQL {
  return sql`EXISTS (select 1 from x_accounts where x_accounts.user_id = ${userId} and x_accounts.connected_at <= ${at} and (x_accounts.disconnected_at is null or x_accounts.disconnected_at > ${at}))`;
}

/**
 * Scheduled posts whose time has already passed without Perch sending them:
 * drafts that were never promoted, or officials scheduled while the account
 * was disconnected.
 */
export function missedSql(userId: number | typeof posts.userId, now: Date): SQL {
  return sql`${posts.scheduledAt} IS NOT NULL
    AND ${posts.scheduledAt} < ${now.getTime()}
    AND (
      ${posts.status} = 'draft'
      OR (${posts.status} = 'official' AND NOT ${accountConnectedAtSql(userId, sql`${posts.scheduledAt}`)})
    )`;
}

/** Official posts due to be sent at `now`, oldest schedule time first. */
export function duePosts(db: Db, now: Date): PostRow[] {
  return db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.status, 'official'),
        isNotNull(posts.scheduledAt),
        sql`coalesce(${posts.nextAttemptAt}, ${posts.scheduledAt}) <= ${now.getTime()}`,
        accountConnectedAtSql(posts.userId, sql`${posts.scheduledAt}`),
      ),
    )
    .orderBy(asc(posts.scheduledAt), asc(posts.id))
    .all();
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

export function linkResources(
  db: Db,
  userId: number,
  postId: number,
  ids: number[],
): PostLinksResponse | null {
  const postRow = getPostRow(db, userId, postId);
  if (!postRow) return null;
  if (postRow.status === 'published') throw new PostImmutableError(postId);

  return {
    results: ids.map((id) => {
      if (!resourceExists(db, userId, id)) {
        return {
          id,
          ok: false as const,
          error: { code: 'not_found', message: `Resource ${id} not found` },
        };
      }
      db.insert(postLinks).values({ postId, resourceId: id }).onConflictDoNothing().run();
      return { id, ok: true as const };
    }),
  };
}

export function unlinkResources(
  db: Db,
  userId: number,
  postId: number,
  ids: number[],
): PostLinksResponse | null {
  const postRow = getPostRow(db, userId, postId);
  if (!postRow) return null;
  if (postRow.status === 'published') throw new PostImmutableError(postId);

  return {
    results: ids.map((id) => {
      if (!resourceExists(db, userId, id)) {
        return {
          id,
          ok: false as const,
          error: { code: 'not_found', message: `Resource ${id} not found` },
        };
      }
      db.delete(postLinks)
        .where(and(eq(postLinks.postId, postId), eq(postLinks.resourceId, id)))
        .run();
      return { id, ok: true as const };
    }),
  };
}

export function deletePosts(
  db: Db,
  userId: number,
  ids: number[],
  removeMediaDir?: (postId: number) => void,
): PostDeleteResponse {
  return {
    results: ids.map((id) => {
      const deleted = db
        .delete(posts)
        .where(and(eq(posts.id, id), eq(posts.userId, userId)))
        .returning({ id: posts.id })
        .get();

      if (!deleted) {
        return {
          id,
          ok: false as const,
          error: { code: 'not_found', message: `Post ${id} not found` },
        };
      }
      try {
        removeMediaDir?.(id);
      } catch {
        // leave the directory; the post row is already gone
      }
      return { id, ok: true as const };
    }),
  };
}

function statusResultError(
  id: number,
  code: string,
  message: string,
  errors?: Array<{ path: string; message: string }>,
): { id: number; ok: false; error: { code: string; message: string; errors?: typeof errors } } {
  return { id, ok: false, error: { code, message, ...(errors ? { errors } : {}) } };
}

export function promotePosts(
  db: Db,
  userId: number,
  ids: number[],
  fileExists: (path: string) => boolean,
  now: Date,
): PostStatusResponse {
  return {
    results: ids.map((id) => {
      const row = getPostRow(db, userId, id);
      if (!row) {
        return statusResultError(id, 'not_found', `Post ${id} not found`);
      }
      if (!(PROMOTE_FROM as readonly string[]).includes(row.status)) {
        return statusResultError(id, 'invalid_status', `Post ${id} is ${row.status}`);
      }
      const mediaRows = db
        .select({ position: postMedia.position, path: postMedia.path })
        .from(postMedia)
        .where(eq(postMedia.postId, id))
        .all();
      const checks = promoteChecks({
        text: row.text,
        limit: postLimit(db, userId),
        media: mediaRows.map((media) => ({
          position: media.position,
          present: fileExists(media.path),
        })),
      });
      if (checks.length > 0) {
        return statusResultError(id, 'validation', `Post ${id} is not ready`, checks);
      }
      db.update(posts)
        .set({ status: 'official', updatedAt: now })
        .where(and(eq(posts.id, id), eq(posts.userId, userId)))
        .run();
      return { id, ok: true as const };
    }),
  };
}

export function demotePosts(db: Db, userId: number, ids: number[], now: Date): PostStatusResponse {
  return {
    results: ids.map((id) => {
      const row = getPostRow(db, userId, id);
      if (!row) {
        return statusResultError(id, 'not_found', `Post ${id} not found`);
      }
      if (!(DEMOTE_FROM as readonly string[]).includes(row.status)) {
        return statusResultError(id, 'invalid_status', `Post ${id} is ${row.status}`);
      }
      db.update(posts)
        .set({ status: 'draft', lastError: null, retryCount: 0, updatedAt: now })
        .where(and(eq(posts.id, id), eq(posts.userId, userId)))
        .run();
      return { id, ok: true as const };
    }),
  };
}

export function schedulePost(
  db: Db,
  userId: number,
  id: number,
  body: PostScheduleBody,
  timeZone: string,
  now: Date,
): Post | null {
  const row = getPostRow(db, userId, id);
  if (!row) return null;
  if (row.status === 'published') throw new PostImmutableError(id);
  if (!(SCHEDULE_FROM as readonly string[]).includes(row.status)) {
    throw new PostStatusError(id, row.status);
  }
  const at = parseScheduleTime(body.at, timeZone, now);
  if (at === null) throw new ScheduleTimeError('Unrecognised time');
  if (at.getTime() < now.getTime() && body.force !== true) {
    throw new ScheduleTimeError('Time is in the past');
  }
  db.update(posts)
    .set({ scheduledAt: at, updatedAt: now })
    .where(and(eq(posts.id, id), eq(posts.userId, userId)))
    .run();
  return getPost(db, userId, id, now);
}

export function unschedulePosts(
  db: Db,
  userId: number,
  ids: number[],
  now: Date,
): PostStatusResponse {
  return {
    results: ids.map((id) => {
      const row = getPostRow(db, userId, id);
      if (!row) {
        return statusResultError(id, 'not_found', `Post ${id} not found`);
      }
      if (!(SCHEDULE_FROM as readonly string[]).includes(row.status)) {
        return statusResultError(id, 'invalid_status', `Post ${id} is ${row.status}`);
      }
      db.update(posts)
        .set({ scheduledAt: null, updatedAt: now })
        .where(and(eq(posts.id, id), eq(posts.userId, userId)))
        .run();
      return { id, ok: true as const };
    }),
  };
}

export function previewPost(db: Db, userId: number, id: number): PostPreview | null {
  const row = getPostRow(db, userId, id);
  if (!row) return null;

  return {
    segments: previewSegments(row.text),
    character_count: weightedLength(row.text),
    limit: postLimit(db, userId),
    estimated_cost: estimateCost(row.text),
  };
}
