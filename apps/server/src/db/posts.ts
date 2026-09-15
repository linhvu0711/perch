import {
  type CalendarPost,
  type CalendarQuery,
  type CalendarRange,
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
  postCalendarTime,
  postListTitle,
  previewSegments,
  promoteChecks,
  type Ready,
  readyChecks,
  SCHEDULE_FROM,
  weightedLength,
  zonedParts,
} from '@perch/core';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import { decodePostCursor, encodePostCursor } from './cursor';
import type { Db } from './index';
import { type MediaFiles, mediaForPosts } from './postMedia';
import { accountConnectedAtSql, attentionSql, missedSql, postState } from './postState';
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
  now: Date,
): Post {
  const scheduled_at = row.scheduledAt?.toISOString() ?? null;
  const { missed, reason } = postState(row);
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    text: row.text,
    scheduled_at,
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
    missed,
    reason,
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

function postJoinRow(db: Db, userId: number, id: number, now: Date): PostJoinRow | undefined {
  return db
    .select({
      ...getTableColumns(posts),
      username: xAccounts.username,
      missed: sql<number>`${missedSql(userId, now)}`,
    })
    .from(posts)
    .leftJoin(xAccounts, eq(xAccounts.id, posts.xAccountId))
    .where(and(eq(posts.id, id), eq(posts.userId, userId)))
    .get();
}

export function getPost(db: Db, userId: number, id: number, now: Date): Post | null {
  const row = postJoinRow(db, userId, id, now);
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
    now,
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
    const waiting = inArray(posts.status, ['draft', 'official']);
    filterConditions.push(
      query.scheduled
        ? and(waiting, gte(posts.scheduledAt, now))!
        : and(waiting, or(isNull(posts.scheduledAt), lt(posts.scheduledAt, now)))!,
    );
  }
  if (query.missed !== undefined) {
    const condition = missedSql(userId, now);
    filterConditions.push(query.missed ? condition : not(sql`(${condition})`));
  }
  if (query.needs_attention !== undefined) {
    const condition = attentionSql(userId, now);
    filterConditions.push(
      query.needs_attention ? condition : not(sql`coalesce((${condition}), 0)`),
    );
  }
  if (query.resource_id !== undefined) {
    filterConditions.push(
      sql`EXISTS (select 1 from post_links where post_links.post_id = ${posts.id} and post_links.resource_id = ${query.resource_id})`,
    );
  }
  filterConditions.push(...tagFilterConditions(db, userId, query.tag ?? []));

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

  const items = postsFromRows(db, userId, pageRows, now);

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

function tagFilterConditions(db: Db, userId: number, tagNames: string[]): SQL[] {
  const conditions: SQL[] = [];
  if (tagNames.length === 0) return conditions;
  const byName = tagIdsByName(db, userId);
  for (const name of tagNames) {
    const tagId = byName.get(name.toLowerCase());
    conditions.push(
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
  return conditions;
}

function postsFromRows(db: Db, userId: number, rows: PostJoinRow[], now: Date): Post[] {
  const limit = postLimit(db, userId);
  const accountConnected = getConnectedAccount(db, userId) !== null;
  const postIds = rows.map((row) => row.id);
  const links = linksForPosts(db, postIds);
  const media = mediaForPosts(db, postIds);
  const postTagsMap = tagsForPosts(db, userId, postIds);
  const items = rows.map((row) => {
    const mediaItems = media.get(row.id) ?? [];
    const post = toPost(
      row,
      links.get(row.id) ?? [],
      mediaItems,
      limit,
      postTagsMap.get(row.id) ?? [],
      readyChecks({
        text: row.text,
        limit,
        mediaCount: mediaItems.length,
        accountConnected,
      }),
      now,
    );
    return { ...post, title: postListTitle(post.title, post.text) };
  });
  return items;
}

/** Posts in `[query.from, query.to]` grouped by calendar day in `timeZone`, ascending. */
export function calendarDays(
  db: Db,
  userId: number,
  query: CalendarQuery,
  timeZone: string,
  now: Date,
): CalendarRange {
  const sortTime = sql`CASE WHEN ${posts.status} = 'published' THEN ${posts.publishedAt} ELSE ${posts.scheduledAt} END`;

  const conditions: SQL[] = [
    eq(posts.userId, userId),
    sql`${sortTime} >= ${dayBoundsUtc(query.from, timeZone).start.getTime()}`,
    sql`${sortTime} <= ${dayBoundsUtc(query.to, timeZone).end.getTime()}`,
    ...tagFilterConditions(db, userId, query.tag ?? []),
  ];

  const rows = db
    .select({
      ...getTableColumns(posts),
      username: xAccounts.username,
      missed: sql<number>`${missedSql(userId, now)}`,
    })
    .from(posts)
    .leftJoin(xAccounts, eq(xAccounts.id, posts.xAccountId))
    .where(and(...conditions))
    .orderBy(asc(sortTime), asc(posts.id))
    .all();

  const items = postsFromRows(db, userId, rows, now);

  const byDay = new Map<string, CalendarPost[]>();
  for (const post of items) {
    const at = postCalendarTime(post);
    if (at === null) continue;
    const date = zonedParts(new Date(at), timeZone).date;
    const day = byDay.get(date) ?? [];
    day.push(post);
    byDay.set(date, day);
  }

  return {
    from: query.from,
    to: query.to,
    days: [...byDay].map(([date, dayPosts]) => ({ date, posts: dayPosts })),
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

/** Draft and Official posts with a schedule time from `now` on, soonest first. */
export function upcomingPosts(
  db: Db,
  userId: number,
  now: Date,
  options: { official?: boolean; limit: number },
): Post[] {
  const rows = db
    .select({
      ...getTableColumns(posts),
      username: xAccounts.username,
      missed: sql<number>`${missedSql(userId, now)}`,
    })
    .from(posts)
    .leftJoin(xAccounts, eq(xAccounts.id, posts.xAccountId))
    .where(
      and(
        eq(posts.userId, userId),
        options.official === true
          ? eq(posts.status, 'official')
          : inArray(posts.status, ['draft', 'official']),
        sql`${posts.scheduledAt} >= ${now.getTime()}`,
      ),
    )
    .orderBy(asc(posts.scheduledAt), asc(posts.id))
    .limit(options.limit)
    .all();
  return postsFromRows(db, userId, rows, now);
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
  commit = true,
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
      if (!commit) return { id, ok: true as const };
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
        .set({
          status: 'draft',
          lastError: null,
          retryCount: 0,
          nextAttemptAt: null,
          updatedAt: now,
        })
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
    .set({
      scheduledAt: at,
      nextAttemptAt: null,
      lastError: null,
      retryCount: 0,
      updatedAt: now,
    })
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
        .set({
          scheduledAt: null,
          nextAttemptAt: null,
          lastError: null,
          retryCount: 0,
          updatedAt: now,
        })
        .where(and(eq(posts.id, id), eq(posts.userId, userId)))
        .run();
      return { id, ok: true as const };
    }),
  };
}

export function dismissPosts(db: Db, userId: number, ids: number[], now: Date): PostStatusResponse {
  return {
    results: ids.map((id) => {
      const row = postJoinRow(db, userId, id, now);
      if (row === undefined) {
        return statusResultError(id, 'not_found', `Post ${id} not found`);
      }
      const { dismiss } = postState(row);
      if (dismiss === null) {
        return statusResultError(id, 'invalid_status', `Post ${id} needs no attention`);
      }
      const guard = and(eq(posts.id, id), eq(posts.userId, userId), eq(posts.status, row.status));
      const updated =
        dismiss === 'demote'
          ? db
              .update(posts)
              .set({
                status: 'draft',
                scheduledAt: null,
                nextAttemptAt: null,
                lastError: null,
                retryCount: 0,
                updatedAt: now,
              })
              .where(guard)
              .returning({ id: posts.id })
              .all().length
          : db
              .update(posts)
              .set({
                scheduledAt: null,
                nextAttemptAt: null,
                lastError: null,
                retryCount: 0,
                updatedAt: now,
              })
              .where(guard)
              .returning({ id: posts.id })
              .all().length;
      if (updated === 0) {
        return statusResultError(id, 'invalid_status', `Post ${id} changed; try again`);
      }
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
