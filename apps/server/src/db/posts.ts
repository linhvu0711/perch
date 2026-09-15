import {
  type CalendarPost,
  type CalendarQuery,
  type CalendarRange,
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
  type PostStatus,
  postCalendarTime,
  postListTitle,
  previewSegments,
  type Ready,
  readyChecks,
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

import { DomainError } from '../errors';
import { decodePostCursor, encodePostCursor } from './cursor';
import type { Db, Tx } from './index';
import { accountConnectedAtSql, attentionSql, missedSql, postState } from './postState';
import { postLinks, postMedia, posts, postTags, resources, xAccounts } from './schema';
import { getSettings } from './settings';
import { addPostTags, tagIdsByName, tagsForPosts, tagsForResources } from './tags';
import { getConnectedAccount } from './xAccounts';

export class InvalidPostCursorError extends DomainError {
  constructor() {
    super('validation', 'cursor', 'Invalid cursor');
  }
}

export class PostImmutableError extends DomainError {
  constructor(postId: number) {
    super('invalid_status', 'status', `Post ${postId} is published`);
  }
}

export class MediaLimitError extends DomainError {
  constructor(path: 'resource_ids' | 'files' | 'from') {
    super('validation', path, 'At most 4 media per post');
  }
}

export class MissingResourceError extends DomainError {
  constructor(resourceId: number) {
    super('validation', 'from', `Resource ${resourceId} not found`);
  }
}

export class TagExistsError extends DomainError {
  constructor(tagName: string) {
    super('validation', 'name', `Tag "${tagName}" already exists`);
  }
}

export type PostRow = typeof posts.$inferSelect;
type PostJoinRow = PostRow & { username: string | null; missed: number };

function toPost(
  row: PostJoinRow,
  links: PostLink[],
  media: PostMedia[],
  limit: number,
  tags: string[],
  ready: Ready,
  _now: Date,
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

export function postLimit(db: Db, userId: number): number {
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

export function createPost(
  db: Db,
  userId: number,
  input: PostCreate,
  now: Date,
  fileExists: (rel: string) => boolean,
): Post {
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

  const post = getPost(db, userId, row.id, now, fileExists);
  if (!post) throw new Error('post insert failed');
  return post;
}

export function postJoinRow(
  db: Db,
  userId: number,
  id: number,
  now: Date,
): PostJoinRow | undefined {
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

export type PostMediaRow = typeof postMedia.$inferSelect;

function toPostMedia(row: PostMediaRow, fileExists: (rel: string) => boolean): PostMedia {
  return {
    id: row.id,
    position: row.position,
    mime: row.mime as PostMedia['mime'],
    bytes: row.bytes,
    from_resource_id: row.fromResourceId,
    present: fileExists(row.path),
  };
}

function mediaForPosts(
  db: Db,
  postIds: number[],
  fileExists: (rel: string) => boolean,
): Map<number, PostMedia[]> {
  const result = new Map<number, PostMedia[]>();
  if (postIds.length === 0) return result;

  const rows = db
    .select()
    .from(postMedia)
    .where(inArray(postMedia.postId, postIds))
    .orderBy(asc(postMedia.postId), asc(postMedia.position))
    .all();

  for (const row of rows) {
    const list = result.get(row.postId) ?? [];
    list.push(toPostMedia(row, fileExists));
    result.set(row.postId, list);
  }
  return result;
}

export function mediaRowsForPost(db: Db | Tx, postId: number): PostMediaRow[] {
  return db
    .select()
    .from(postMedia)
    .where(eq(postMedia.postId, postId))
    .orderBy(asc(postMedia.position))
    .all();
}

export function mediaRowForPost(
  db: Db,
  userId: number,
  postId: number,
  mediaId: number,
): PostMediaRow | undefined {
  return db
    .select({ media: postMedia })
    .from(postMedia)
    .innerJoin(posts, eq(postMedia.postId, posts.id))
    .where(and(eq(postMedia.postId, postId), eq(postMedia.id, mediaId), eq(posts.userId, userId)))
    .get()?.media;
}

export function insertMediaRow(
  db: Db | Tx,
  postId: number,
  position: number,
  file: { path: string; mime: PostMedia['mime']; bytes: number },
  fromResourceId: number | null,
  fileExists: (rel: string) => boolean,
): PostMedia {
  const row = db
    .insert(postMedia)
    .values({
      postId,
      position,
      path: file.path,
      mime: file.mime,
      bytes: file.bytes,
      fromResourceId,
    })
    .returning()
    .get();
  if (!row) throw new Error('post_media insert failed');
  return toPostMedia(row, fileExists);
}

export function insertPostLink(db: Db | Tx, postId: number, resourceId: number): void {
  db.insert(postLinks).values({ postId, resourceId }).onConflictDoNothing().run();
}

/** Deletes the given media rows and renumbers the kept rows from 1, in one transaction. */
export function removeMediaRows(db: Db, deletedIds: number[], kept: PostMediaRow[]): void {
  db.transaction((tx) => {
    if (deletedIds.length > 0) {
      tx.delete(postMedia).where(inArray(postMedia.id, deletedIds)).run();
    }
    kept.forEach((row, index) => {
      const target = index + 1;
      if (row.position !== target) {
        tx.update(postMedia).set({ position: target }).where(eq(postMedia.id, row.id)).run();
      }
    });
  });
}

/** Inserts media rows from a fresh count inside the transaction — which also decides the media cap — and a post link per sourced row. */
export function insertMediaRows(
  db: Db,
  postId: number,
  limitPath: 'resource_ids' | 'files',
  files: Array<{
    path: string;
    mime: PostMedia['mime'];
    bytes: number;
    fromResourceId: number | null;
  }>,
  fileExists: (rel: string) => boolean,
): PostMedia[] {
  return db.transaction((tx) => {
    const count = mediaRowsForPost(tx, postId).length;
    if (count + files.length > POST_MEDIA_MAX) throw new MediaLimitError(limitPath);
    return files.map((file, index) => {
      const media = insertMediaRow(
        tx,
        postId,
        count + 1 + index,
        file,
        file.fromResourceId,
        fileExists,
      );
      if (file.fromResourceId !== null) insertPostLink(tx, postId, file.fromResourceId);
      return media;
    });
  });
}

export function getPost(
  db: Db,
  userId: number,
  id: number,
  now: Date,
  fileExists: (rel: string) => boolean,
): Post | null {
  const row = postJoinRow(db, userId, id, now);
  if (!row) return null;

  const limit = postLimit(db, userId);
  const media = mediaForPosts(db, [row.id], fileExists).get(row.id) ?? [];
  return toPost(
    row,
    linksForPosts(db, [row.id]).get(row.id) ?? [],
    media,
    limit,
    tagsForPosts(db, userId, [row.id]).get(row.id) ?? [],
    readyChecks({
      text: row.text,
      limit,
      media: media.map(({ position, present }) => ({ position, present })),
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
  fileExists: (rel: string) => boolean,
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
      ) as SQL,
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
        ? (and(waiting, gte(posts.scheduledAt, now)) as SQL)
        : (and(waiting, or(isNull(posts.scheduledAt), lt(posts.scheduledAt, now))) as SQL),
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
        : (or(
            sql`${sortTime} < ${key.time}`,
            sql`${sortTime} = ${key.time} AND ${posts.id} < ${key.id}`,
            sql`${sortTime} IS NULL`,
          ) as SQL),
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

  const items = postsFromRows(db, userId, pageRows, now, fileExists);

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

function postsFromRows(
  db: Db,
  userId: number,
  rows: PostJoinRow[],
  now: Date,
  fileExists: (rel: string) => boolean,
): Post[] {
  const limit = postLimit(db, userId);
  const accountConnected = getConnectedAccount(db, userId) !== null;
  const postIds = rows.map((row) => row.id);
  const links = linksForPosts(db, postIds);
  const media = mediaForPosts(db, postIds, fileExists);
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
        media: mediaItems.map(({ position, present }) => ({ position, present })),
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
  fileExists: (rel: string) => boolean,
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

  const items = postsFromRows(db, userId, rows, now, fileExists);

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
  fileExists: (rel: string) => boolean,
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

  return getPost(db, userId, id, now, fileExists);
}

export function getPostRow(db: Db, userId: number, id: number): PostRow | undefined {
  return db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, userId)))
    .get();
}

export type PostRowPatch = Partial<
  Pick<
    PostRow,
    | 'status'
    | 'scheduledAt'
    | 'nextAttemptAt'
    | 'lastError'
    | 'retryCount'
    | 'publishedAt'
    | 'xAccountId'
    | 'xPostId'
  >
>;

export function patchPostRow(
  db: Db | Tx,
  userId: number,
  id: number,
  patch: PostRowPatch,
  now: Date,
  fromStatus?: PostStatus,
): boolean {
  const guard =
    fromStatus === undefined
      ? and(eq(posts.id, id), eq(posts.userId, userId))
      : and(eq(posts.id, id), eq(posts.userId, userId), eq(posts.status, fromStatus));
  return (
    db
      .update(posts)
      .set({ ...patch, updatedAt: now })
      .where(guard)
      .returning({ id: posts.id })
      .all().length === 1
  );
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
  fileExists: (rel: string) => boolean,
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
  return postsFromRows(db, userId, rows, now, fileExists);
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
  inFlight?: (id: number) => boolean,
): PostDeleteResponse {
  return {
    results: ids.map((id) => {
      if (inFlight?.(id)) {
        return {
          id,
          ok: false as const,
          error: { code: 'in_flight', message: `Post ${id} is being sent` },
        };
      }
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
