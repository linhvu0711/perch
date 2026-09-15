import { type Post, type PostMediaDetachBody } from '@perch/core';
import { eq, inArray } from 'drizzle-orm';

import { DomainError } from '../errors';
import type { Db } from './index';
import {
  getPost,
  getPostRow,
  mediaRowsForPost,
  type PostMediaRow,
  PostImmutableError,
} from './posts';
import { postMedia } from './schema';

export class MissingMediaPositionError extends DomainError {
  constructor(_postId: number, position: number) {
    super('validation', 'positions', `No media at position ${position}`);
  }
}

export interface MediaFiles {
  read(rel: string): Promise<Uint8Array | null>;
  store(postId: number, bytes: Uint8Array, ext: string): Promise<string>;
  remove(rel: string): void;
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
