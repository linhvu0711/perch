import {
  noteTitle,
  type NoteCreate,
  type Resource,
  type ResourceDeleteResponse,
  type ResourceList,
  type ResourceListQuery,
  type ResourcePatch,
} from '@perch/core';
import { and, asc, count, desc, eq, gt, lt, or, sql, type SQL } from 'drizzle-orm';

import { decodeCursor, encodeCursor } from './cursor';
import type { Db } from './index';
import { resources } from './schema';

export class InvalidCursorError extends Error {}

type ResourceRow = typeof resources.$inferSelect;

function toResource(row: ResourceRow): Resource {
  if (row.type !== 'md') throw new Error('unsupported resource type');

  return {
    id: row.id,
    type: 'md',
    title: row.title,
    notes: row.notes,
    created_at: row.createdAt.toISOString(),
    body: row.mdBody ?? '',
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
  return toResource(row);
}

export function getResource(db: Db, userId: number, id: number): Resource | null {
  const row = db
    .select()
    .from(resources)
    .where(and(eq(resources.id, id), eq(resources.userId, userId)))
    .get();

  return row ? toResource(row) : null;
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

  const row = db
    .update(resources)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.body !== undefined ? { mdBody: patch.body } : {}),
    })
    .where(and(eq(resources.id, id), eq(resources.userId, userId)))
    .returning()
    .get();

  if (!row) throw new Error('resource update failed');
  return toResource(row);
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

  if (query.cursor !== undefined) {
    const key = decodeCursor(query.cursor);
    if (!key) throw new InvalidCursorError();

    const createdAt = new Date(key.createdAt);
    pageConditions.push(
      query.order === 'desc'
        ? or(
            lt(resources.createdAt, createdAt),
            and(eq(resources.createdAt, createdAt), lt(resources.id, key.id)),
          )!
        : or(
            gt(resources.createdAt, createdAt),
            and(eq(resources.createdAt, createdAt), gt(resources.id, key.id)),
          )!,
    );
  }

  const rows = db
    .select()
    .from(resources)
    .where(and(...pageConditions))
    .orderBy(
      ...(query.order === 'desc'
        ? [desc(resources.createdAt), desc(resources.id)]
        : [asc(resources.createdAt), asc(resources.id)]),
    )
    .limit(query.limit + 1)
    .all();

  const hasNextPage = rows.length > query.limit;
  const pageRows = hasNextPage ? rows.slice(0, query.limit) : rows;
  const last = pageRows.at(-1);

  return {
    items: pageRows.map(toResource),
    total: totalRow?.value ?? 0,
    next_cursor:
      hasNextPage && last
        ? encodeCursor({ createdAt: last.createdAt.getTime(), id: last.id })
        : null,
  };
}

export function deleteResources(
  db: Db,
  userId: number,
  ids: number[],
): ResourceDeleteResponse {
  return {
    results: ids.map((id) => {
      const deleted = db
        .delete(resources)
        .where(and(eq(resources.id, id), eq(resources.userId, userId)))
        .returning({ id: resources.id })
        .get();

      return deleted
        ? { id, ok: true as const, unlinked_post_ids: [] }
        : {
            id,
            ok: false as const,
            error: { code: 'not_found', message: `Resource ${id} not found` },
          };
    }),
  };
}
