import {
  POST_MEDIA_MAX,
  type Post,
  type PostMedia,
  type PostMediaAttachResponse,
  type PostMediaDetachBody,
  type PostMediaFilesResponse,
} from '@perch/core';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { DomainError } from '../errors';
import type { Db } from './index';
import { getPost, MediaLimitError, PostImmutableError } from './posts';
import { postLinks, postMedia, posts, resources } from './schema';

export class MissingMediaPositionError extends DomainError {
  constructor(_postId: number, position: number) {
    super('validation', 'positions', `No media at position ${position}`);
  }
}

type PostMediaRow = typeof postMedia.$inferSelect;

export interface MediaFiles {
  read(rel: string): Promise<Uint8Array | null>;
  store(postId: number, bytes: Uint8Array, ext: string): Promise<string>;
  remove(rel: string): void;
}

function toPostMedia(row: PostMediaRow): PostMedia {
  return {
    id: row.id,
    position: row.position,
    mime: row.mime as PostMedia['mime'],
    bytes: row.bytes,
    from_resource_id: row.fromResourceId,
  };
}

export function mediaForPosts(db: Db, postIds: number[]): Map<number, PostMedia[]> {
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
    list.push(toPostMedia(row));
    result.set(row.postId, list);
  }
  return result;
}

export function mediaPathsForPosts(
  db: Db,
  postIds: number[],
): Map<number, Array<{ position: number; path: string }>> {
  const result = new Map<number, Array<{ position: number; path: string }>>();
  if (postIds.length === 0) return result;

  const rows = db
    .select({ postId: postMedia.postId, position: postMedia.position, path: postMedia.path })
    .from(postMedia)
    .where(inArray(postMedia.postId, postIds))
    .orderBy(asc(postMedia.postId), asc(postMedia.position))
    .all();

  for (const row of rows) {
    const list = result.get(row.postId) ?? [];
    list.push({ position: row.position, path: row.path });
    result.set(row.postId, list);
  }
  return result;
}

function getPostRow(db: Db, userId: number, postId: number) {
  return db
    .select()
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
    .get();
}

export function mediaRowsForPost(db: Db, postId: number): PostMediaRow[] {
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

function insertMediaRow(
  db: Db,
  postId: number,
  position: number,
  file: { path: string; mime: PostMedia['mime']; bytes: number },
  fromResourceId: number | null,
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
  return toPostMedia(row);
}

export async function attachFromResources(
  db: Db,
  userId: number,
  postId: number,
  ids: number[],
  files: MediaFiles,
): Promise<PostMediaAttachResponse | null> {
  const postRow = getPostRow(db, userId, postId);
  if (!postRow) return null;
  if (postRow.status === 'published') throw new PostImmutableError(postId);

  const existing = mediaRowsForPost(db, postId);
  if (existing.length + ids.length > POST_MEDIA_MAX) {
    throw new MediaLimitError('resource_ids');
  }

  let next = existing.length + 1;
  const results: PostMediaAttachResponse['results'] = [];
  for (const id of ids) {
    const resource = db
      .select()
      .from(resources)
      .where(and(eq(resources.id, id), eq(resources.userId, userId)))
      .get();
    if (!resource) {
      results.push({
        id,
        ok: false,
        error: { code: 'not_found', message: `Resource ${id} not found` },
      });
      continue;
    }
    if (resource.type !== 'image' || !resource.imagePath) {
      results.push({
        id,
        ok: false,
        error: { code: 'not_image', message: `Resource ${id} is not an image` },
      });
      continue;
    }
    const bytes = await files.read(resource.imagePath);
    if (!bytes) {
      results.push({
        id,
        ok: false,
        error: { code: 'file_missing', message: `Resource ${id} file is missing` },
      });
      continue;
    }

    const ext = resource.imagePath.split('.').pop() ?? 'png';
    const rel = await files.store(postId, bytes, ext);
    const media = insertMediaRow(
      db,
      postId,
      next++,
      {
        path: rel,
        mime: (resource.imageMime ?? 'image/png') as PostMedia['mime'],
        bytes: bytes.length,
      },
      id,
    );
    db.insert(postLinks).values({ postId, resourceId: id }).onConflictDoNothing().run();
    results.push({ id, ok: true, media });
  }
  return { results };
}

export interface MediaFileInput {
  name: string;
  bytes: Uint8Array;
  mime: PostMedia['mime'];
  ext: string;
}

export async function attachFromFiles(
  db: Db,
  userId: number,
  postId: number,
  inputs: MediaFileInput[],
  files: MediaFiles,
): Promise<PostMediaFilesResponse | null> {
  const postRow = getPostRow(db, userId, postId);
  if (!postRow) return null;
  if (postRow.status === 'published') throw new PostImmutableError(postId);

  const existing = mediaRowsForPost(db, postId);
  if (existing.length + inputs.length > POST_MEDIA_MAX) {
    throw new MediaLimitError('files');
  }

  let next = existing.length + 1;
  const results: PostMediaFilesResponse['results'] = [];
  for (const input of inputs) {
    const rel = await files.store(postId, input.bytes, input.ext);
    const media = insertMediaRow(
      db,
      postId,
      next++,
      { path: rel, mime: input.mime, bytes: input.bytes.length },
      null,
    );
    results.push({ name: input.name, ok: true, media });
  }
  return { results };
}

export function detachMedia(
  db: Db,
  userId: number,
  postId: number,
  body: PostMediaDetachBody,
  remove: (rel: string) => void,
  fileExists: (rel: string) => boolean,
): Post | null {
  const postRow = getPostRow(db, userId, postId);
  if (!postRow) return null;
  if (postRow.status === 'published') throw new PostImmutableError(postId);

  const rows = mediaRowsForPost(db, postId);
  let deleted: PostMediaRow[];
  let kept: PostMediaRow[];
  if ('all' in body) {
    deleted = rows;
    kept = [];
  } else {
    const byPosition = new Map(rows.map((row) => [row.position, row]));
    const picked = new Set<number>();
    deleted = [];
    for (const position of body.positions) {
      const row = byPosition.get(position);
      if (!row || picked.has(position)) {
        throw new MissingMediaPositionError(postId, position);
      }
      picked.add(position);
      deleted.push(row);
    }
    kept = rows.filter((row) => !picked.has(row.position));
  }

  const deletedIds = deleted.map((row) => row.id);
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
  let cleanupError: unknown;
  for (const row of deleted) {
    try {
      remove(row.path);
    } catch (error) {
      cleanupError ??= error;
    }
  }
  if (cleanupError !== undefined) throw cleanupError;
  return getPost(db, userId, postId, new Date(), fileExists);
}
