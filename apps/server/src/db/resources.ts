import {
  noteTitle,
  type ImageResource,
  type NoteCreate,
  type Resource,
  type ResourceDeleteResponse,
  type ResourceList,
  type ResourceListQuery,
  type ResourcePatch,
} from '@perch/core';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  lt,
  or,
  sql,
  getTableColumns,
  type SQL,
} from 'drizzle-orm';

import { decodeCursor, encodeCursor } from './cursor';
import type { Db } from './index';
import { postLinks, resources } from './schema';

export class InvalidCursorError extends Error {}

type ResourceRow = typeof resources.$inferSelect;

const usedByCount = sql<number>`(select count(*) from post_links where post_links.resource_id = ${resources.id})`;

const resourceColumns = () => ({
  ...getTableColumns(resources),
  usedBy: usedByCount,
});

function toResource(row: ResourceRow, usedBy = 0): Resource {
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
    };
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
  };
}

export function createNote(db: Db, userId: number, input: NoteCreate, now: Date): Resource {
  const row = db
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

  if (!row) throw new Error('resource insert failed');
  return toResource(row, 0);
}

export function createImage(
  db: Db,
  userId: number,
  input: {
    title: string;
    notes?: string;
    path: string;
    mime: ImageResource['mime'];
    bytes: number;
    width: number;
    height: number;
  },
  now: Date,
): Resource {
  const row = db
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

  if (!row) throw new Error('resource insert failed');
  return toResource(row);
}

export function getResource(db: Db, userId: number, id: number): Resource | null {
  const row = db
    .select(resourceColumns())
    .from(resources)
    .where(and(eq(resources.id, id), eq(resources.userId, userId)))
    .get();

  return row ? toResource(row, row.usedBy) : null;
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

  return rows.map((row) => toResource(row, row.usedBy));
}

export function listResources(
  db: Db,
  userId: number,
  query: ResourceListQuery,
): ResourceList {
  const filterConditions: SQL[] = [eq(resources.userId, userId)];

  if (query.type !== undefined) filterConditions.push(eq(resources.type, query.type));
  if (query.search) {
    const escaped = query.search.replace(/[\\%_]/g, '\\$&');
    const pattern = `%${escaped}%`;
    filterConditions.push(
      or(
        sql`${resources.title} LIKE ${pattern} ESCAPE '\\'`,
        sql`${resources.mdBody} LIKE ${pattern} ESCAPE '\\'`,
      )!,
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

    pageConditions.push(
      query.order === 'desc'
        ? or(
            lt(sortValue, key.createdAt),
            and(
              eq(sortValue, key.createdAt),
              sortByUsed
                ? gt(resources.id, key.id)
                : lt(resources.id, key.id),
            ),
          )!
        : or(
            gt(sortValue, key.createdAt),
            and(eq(sortValue, key.createdAt), gt(resources.id, key.id)),
          )!,
    );
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

  return {
    items: pageRows.map((row) => toResource(row, row.usedBy)),
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
