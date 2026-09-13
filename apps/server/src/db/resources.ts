import {
  type ImageResource,
  type NoteCreate,
  noteTitle,
  type Resource,
  type ResourceAuthors,
  type ResourceDeleteResponse,
  type ResourceList,
  type ResourceListQuery,
  type ResourcePatch,
  type TweetResource,
  tweetTitle,
  zonedDayEnd,
  zonedDayStart,
} from '@perch/core';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import { decodeCursor, encodeCursor } from './cursor';
import type { Db } from './index';
import { postLinks, resources, resourceTags, tags } from './schema';
import { getSettings } from './settings';
import { addResourceTags, tagsForResources } from './tags';

export class InvalidCursorError extends Error {}

type ResourceRow = typeof resources.$inferSelect;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const usedByCount = sql<number>`(select count(*) from post_links where post_links.resource_id = ${resources.id})`;

const resourceColumns = () => ({
  ...getTableColumns(resources),
  usedBy: usedByCount,
});

function toResource(row: ResourceRow, usedBy = 0, tags: string[] = []): Resource {
  if (row.type === 'image') {
    if (
      row.imagePath === null ||
      row.imageMime === null ||
      row.imageBytes === null ||
      row.imageWidth === null ||
      row.imageHeight === null
    ) {
      throw new Error('image row without file fields');
    }
    return {
      id: row.id,
      type: 'image',
      title: row.title,
      notes: row.notes,
      created_at: row.createdAt.toISOString(),
      path: row.imagePath,
      mime: row.imageMime as ImageResource['mime'],
      bytes: row.imageBytes,
      width: row.imageWidth,
      height: row.imageHeight,
      ...(usedBy > 0 ? { used_by: usedBy } : {}),
      tags,
    };
  }
  if (row.type === 'tweet') {
    if (
      row.tweetUrl === null ||
      row.tweetXId === null ||
      row.tweetAuthorId === null ||
      row.tweetAuthorUsername === null ||
      row.tweetText === null ||
      row.tweetPostedAt === null
    ) {
      throw new Error('tweet row missing fields');
    }
    const resource: TweetResource = {
      id: row.id,
      type: 'tweet',
      title: row.title,
      notes: row.notes,
      created_at: row.createdAt.toISOString(),
      url: row.tweetUrl,
      x_id: row.tweetXId,
      author_id: row.tweetAuthorId,
      author_username: row.tweetAuthorUsername,
      text: row.tweetText,
      posted_at: row.tweetPostedAt.toISOString(),
      ...(usedBy > 0 ? { used_by: usedBy } : {}),
      tags,
    };
    return resource;
  }
  if (row.type !== 'md') throw new Error('unsupported resource type');

  return {
    id: row.id,
    type: 'md',
    title: row.title,
    notes: row.notes,
    created_at: row.createdAt.toISOString(),
    body: row.mdBody ?? '',
    used_by: usedBy,
    tags,
  };
}

export function createTweet(
  db: Db | Tx,
  userId: number,
  input: {
    url: string;
    xId: string;
    authorId: string;
    authorUsername: string;
    text: string;
    title: string;
    postedAt: Date;
    tags?: string[];
  },
  now: Date,
): TweetResource {
  const row = db.transaction((tx) => {
    const inserted = tx
      .insert(resources)
      .values({
        userId,
        type: 'tweet',
        title: input.title,
        notes: '',
        createdAt: now,
        tweetUrl: input.url,
        tweetXId: input.xId,
        tweetAuthorId: input.authorId,
        tweetAuthorUsername: input.authorUsername,
        tweetText: input.text,
        tweetPostedAt: input.postedAt,
      })
      .returning()
      .get();
    if (!inserted) throw new Error('tweet insert failed');
    if (input.tags !== undefined) addResourceTags(tx, userId, inserted.id, input.tags);
    return inserted;
  });
  return toResource(row, 0, tagsForResources(db, [row.id]).get(row.id) ?? []) as TweetResource;
}

export function findTweetByXId(db: Db, userId: number, xId: string): TweetResource | null {
  const row = db
    .select(resourceColumns())
    .from(resources)
    .where(
      and(eq(resources.userId, userId), eq(resources.type, 'tweet'), eq(resources.tweetXId, xId)),
    )
    .get();
  return row
    ? (toResource(
        row,
        row.usedBy,
        tagsForResources(db, [row.id]).get(row.id) ?? [],
      ) as TweetResource)
    : null;
}

export function updateTweet(
  db: Db,
  userId: number,
  id: number,
  input: {
    url: string;
    authorId: string;
    authorUsername: string;
    text: string;
    title: string;
    postedAt: Date;
  },
): TweetResource | null {
  const current = db
    .select()
    .from(resources)
    .where(and(eq(resources.id, id), eq(resources.userId, userId)))
    .get();
  if (!current) return null;

  db.update(resources)
    .set({
      // An untouched derived title follows the text; a user-set title stays.
      title: current.title === tweetTitle(current.tweetText ?? '') ? input.title : current.title,
      tweetUrl: input.url,
      tweetAuthorId: input.authorId,
      tweetAuthorUsername: input.authorUsername,
      tweetText: input.text,
      tweetPostedAt: input.postedAt,
    })
    .where(and(eq(resources.id, id), eq(resources.userId, userId)))
    .run();

  const updated = getResource(db, userId, id);
  return updated?.type === 'tweet' ? updated : null;
}

export function listTweetAuthors(db: Db, userId: number): ResourceAuthors {
  const authors = db
    .select({
      username: resources.tweetAuthorUsername,
      count: count(),
    })
    .from(resources)
    .where(and(eq(resources.userId, userId), eq(resources.type, 'tweet')))
    .groupBy(resources.tweetAuthorUsername)
    .orderBy(sql`lower(${resources.tweetAuthorUsername})`)
    .all()
    .filter((row): row is { username: string; count: number } => row.username !== null);
  return { authors };
}

export function createNote(db: Db | Tx, userId: number, input: NoteCreate, now: Date): Resource {
  const row = db.transaction((tx) => {
    const inserted = tx
      .insert(resources)
      .values({
        userId,
        type: 'md',
        title: noteTitle(input.body, input.title),
        notes: input.notes ?? '',
        createdAt: now,
        mdBody: input.body,
      })
      .returning()
      .get();
    if (!inserted) throw new Error('resource insert failed');
    if (input.tags !== undefined) addResourceTags(tx, userId, inserted.id, input.tags);
    return inserted;
  });

  return toResource(row, 0, tagsForResources(db, [row.id]).get(row.id) ?? []);
}

export function createImage(
  db: Db | Tx,
  userId: number,
  input: {
    title: string;
    notes?: string;
    path: string;
    mime: ImageResource['mime'];
    bytes: number;
    width: number;
    height: number;
    tags?: string[];
  },
  now: Date,
): Resource {
  const row = db.transaction((tx) => {
    const inserted = tx
      .insert(resources)
      .values({
        userId,
        type: 'image',
        title: input.title,
        notes: input.notes ?? '',
        createdAt: now,
        imagePath: input.path,
        imageMime: input.mime,
        imageBytes: input.bytes,
        imageWidth: input.width,
        imageHeight: input.height,
      })
      .returning()
      .get();
    if (!inserted) throw new Error('resource insert failed');
    if (input.tags !== undefined) addResourceTags(tx, userId, inserted.id, input.tags);
    return inserted;
  });

  return toResource(row, 0, tagsForResources(db, [row.id]).get(row.id) ?? []);
}

export function getResource(db: Db | Tx, userId: number, id: number): Resource | null {
  const row = db
    .select(resourceColumns())
    .from(resources)
    .where(and(eq(resources.id, id), eq(resources.userId, userId)))
    .get();

  return row ? toResource(row, row.usedBy, tagsForResources(db, [row.id]).get(row.id) ?? []) : null;
}

export function updateResource(
  db: Db,
  userId: number,
  id: number,
  patch: ResourcePatch,
): Resource | null {
  const current = db
    .select()
    .from(resources)
    .where(and(eq(resources.id, id), eq(resources.userId, userId)))
    .get();

  if (!current) return null;
  if (patch.body !== undefined && current.type !== 'md') {
    throw new Error('body is only valid for notes');
  }

  db.update(resources)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.body !== undefined ? { mdBody: patch.body } : {}),
    })
    .where(and(eq(resources.id, id), eq(resources.userId, userId)))
    .run();

  return getResource(db, userId, id);
}

export function listAllResources(db: Db, userId: number): Resource[] {
  const rows = db
    .select(resourceColumns())
    .from(resources)
    .where(eq(resources.userId, userId))
    .orderBy(asc(resources.createdAt), asc(resources.id))
    .all();

  const tagsById = tagsForResources(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toResource(row, row.usedBy, tagsById.get(row.id) ?? []));
}

export function listResources(db: Db, userId: number, query: ResourceListQuery): ResourceList {
  const filterConditions: SQL[] = [eq(resources.userId, userId)];

  if (query.type !== undefined) filterConditions.push(eq(resources.type, query.type));
  if (query.search) {
    const escaped = query.search.replace(/[\\%_]/g, '\\$&');
    const pattern = `%${escaped}%`;
    const searchCondition = or(
      sql`${resources.title} LIKE ${pattern} ESCAPE '\\'`,
      sql`${resources.mdBody} LIKE ${pattern} ESCAPE '\\'`,
      sql`${resources.tweetText} LIKE ${pattern} ESCAPE '\\'`,
    );
    if (searchCondition) filterConditions.push(searchCondition);
  }
  if (query.author) {
    const escaped = query.author.replace(/[\\%_]/g, '\\$&');
    filterConditions.push(sql`${resources.tweetAuthorUsername} LIKE ${escaped} ESCAPE '\\'`);
  }
  if (query.from || query.to) {
    const timezone = getSettings(db, userId).timezone;
    if (query.from)
      filterConditions.push(gte(resources.createdAt, zonedDayStart(query.from, timezone)));
    if (query.to) filterConditions.push(lt(resources.createdAt, zonedDayEnd(query.to, timezone)));
  }
  for (const name of query.tag ?? []) {
    filterConditions.push(
      sql`exists (select 1 from ${resourceTags} join ${tags} on ${tags.id} = ${resourceTags.tagId} where ${resourceTags.resourceId} = ${resources.id} and ${tags.userId} = ${userId} and lower(${tags.name}) = lower(${name}))`,
    );
  }

  const totalRow = db
    .select({ value: count() })
    .from(resources)
    .where(and(...filterConditions))
    .get();
  const pageConditions = [...filterConditions];

  const sortByUsed = query.sort === 'used';
  const sortValue = sortByUsed ? usedByCount : sql`${resources.createdAt}`;

  if (query.cursor !== undefined) {
    const key = decodeCursor(query.cursor);
    if (!key) throw new InvalidCursorError();

    const pageCondition =
      query.order === 'desc'
        ? or(
            lt(sortValue, key.createdAt),
            and(
              eq(sortValue, key.createdAt),
              sortByUsed ? gt(resources.id, key.id) : lt(resources.id, key.id),
            ),
          )
        : or(
            gt(sortValue, key.createdAt),
            and(eq(sortValue, key.createdAt), gt(resources.id, key.id)),
          );
    if (pageCondition) pageConditions.push(pageCondition);
  }

  const rows = db
    .select(resourceColumns())
    .from(resources)
    .where(and(...pageConditions))
    .orderBy(
      ...(query.order === 'desc'
        ? sortByUsed
          ? [desc(sortValue), asc(resources.id)]
          : [desc(sortValue), desc(resources.id)]
        : [asc(sortValue), asc(resources.id)]),
    )
    .limit(query.limit + 1)
    .all();

  const hasNextPage = rows.length > query.limit;
  const pageRows = hasNextPage ? rows.slice(0, query.limit) : rows;
  const last = pageRows.at(-1);

  const tagsById = tagsForResources(
    db,
    pageRows.map((row) => row.id),
  );

  return {
    items: pageRows.map((row) => toResource(row, row.usedBy, tagsById.get(row.id) ?? [])),
    total: totalRow?.value ?? 0,
    next_cursor:
      hasNextPage && last
        ? encodeCursor({
            createdAt: sortByUsed ? last.usedBy : last.createdAt.getTime(),
            id: last.id,
          })
        : null,
  };
}

export function deleteResources(
  db: Db,
  userId: number,
  ids: number[],
  removeFile: (rel: string) => void = () => {},
): ResourceDeleteResponse {
  return {
    results: ids.map((id) => {
      const row = db
        .select({ imagePath: resources.imagePath })
        .from(resources)
        .where(and(eq(resources.id, id), eq(resources.userId, userId)))
        .get();

      const linkedPostIds = db
        .select({ postId: postLinks.postId })
        .from(postLinks)
        .where(eq(postLinks.resourceId, id))
        .orderBy(asc(postLinks.postId))
        .all()
        .map((row) => row.postId);

      const deleted = db
        .delete(resources)
        .where(and(eq(resources.id, id), eq(resources.userId, userId)))
        .returning({ id: resources.id })
        .get();

      if (deleted && row?.imagePath) removeFile(row.imagePath);

      return deleted
        ? { id, ok: true as const, unlinked_post_ids: linkedPostIds }
        : {
            id,
            ok: false as const,
            error: { code: 'not_found', message: `Resource ${id} not found` },
          };
    }),
  };
}
