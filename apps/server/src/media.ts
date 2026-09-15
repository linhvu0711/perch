import {
  POST_MEDIA_MAX,
  type Post,
  type PostMediaAttachResponse,
  type PostMediaDetachBody,
  type PostMediaFilesResponse,
} from '@perch/core';

import type { Clock } from './clock';
import type { Db } from './db';
import {
  getPost,
  getPostRow,
  insertMediaRow,
  insertPostLink,
  MediaLimitError,
  type PostMediaRow,
  mediaRowsForPost,
  PostImmutableError,
  removeMediaRows,
} from './db/posts';
import { getResource } from './db/resources';
import { DomainError } from './errors';
import {
  copyToR2,
  inspectImage,
  mediaFileExists,
  readMedia,
  removeMedia,
  storeMedia,
} from './images';
import type { R2Client } from './r2/client';

export class MediaAttachError extends DomainError {
  constructor(messages: string[]) {
    super(
      'validation',
      'from',
      messages[0] ?? 'Attach failed',
      messages.map((message) => ({ path: 'from', message })),
    );
  }
}

export interface MediaService {
  attachFromResources(
    userId: number,
    postId: number,
    ids: number[],
  ): Promise<PostMediaAttachResponse | null>;
  attachFromFiles(
    userId: number,
    postId: number,
    files: MediaFileInput[],
  ): Promise<PostMediaFilesResponse | null>;
  detach(userId: number, postId: number, body: PostMediaDetachBody): Post | null;
  exists(rel: string): boolean;
}

export class MissingMediaPositionError extends DomainError {
  constructor(_postId: number, position: number) {
    super('validation', 'positions', `No media at position ${position}`);
  }
}

export interface MediaFileInput {
  name: string;
  bytes: Uint8Array;
}

export function createMediaService(deps: {
  db: Db;
  uploadDir: string;
  r2: R2Client | null;
  clock: Clock;
  logError: (error: unknown) => void;
}): MediaService {
  const fileExists = mediaFileExists(deps.uploadDir);

  return {
    async attachFromResources(userId, postId, ids) {
      const postRow = getPostRow(deps.db, userId, postId);
      if (!postRow) return null;
      if (postRow.status === 'published') throw new PostImmutableError(postId);

      const existing = mediaRowsForPost(deps.db, postId);
      if (existing.length + ids.length > POST_MEDIA_MAX) {
        throw new MediaLimitError('resource_ids');
      }

      let next = existing.length + 1;
      const results: PostMediaAttachResponse['results'] = [];
      for (const id of ids) {
        const resource = getResource(deps.db, userId, id);
        if (!resource) {
          results.push({
            id,
            ok: false,
            error: { code: 'not_found', message: `Resource ${id} not found` },
          });
          continue;
        }
        if (resource.type !== 'image') {
          results.push({
            id,
            ok: false,
            error: { code: 'not_image', message: `Resource ${id} is not an image` },
          });
          continue;
        }
        const bytes = await readMedia(deps.uploadDir, resource.path);
        if (!bytes) {
          results.push({
            id,
            ok: false,
            error: { code: 'file_missing', message: 'Image file is missing' },
          });
          continue;
        }

        const ext = resource.path.split('.').pop() ?? 'png';
        const rel = await storeMedia(deps.uploadDir, userId, postId, bytes, ext);
        await copyToR2(deps.r2, rel, bytes, deps.logError);
        const media = insertMediaRow(
          deps.db,
          postId,
          next++,
          { path: rel, mime: resource.mime, bytes: bytes.length },
          id,
        );
        insertPostLink(deps.db, postId, id);
        results.push({ id, ok: true, media });
      }
      return { results };
    },

    async attachFromFiles(userId, postId, files) {
      const postRow = getPostRow(deps.db, userId, postId);
      if (!postRow) return null;
      if (postRow.status === 'published') throw new PostImmutableError(postId);

      const inspected: Array<{
        file: MediaFileInput;
        result: Awaited<ReturnType<typeof inspectImage>>;
      }> = [];
      for (const file of files) {
        inspected.push({ file, result: await inspectImage(file.bytes) });
      }

      const valid = inspected.filter(({ result }) => result.ok);
      const existing = mediaRowsForPost(deps.db, postId);
      if (existing.length + valid.length > POST_MEDIA_MAX) {
        throw new MediaLimitError('files');
      }

      let next = existing.length + 1;
      const results: PostMediaFilesResponse['results'] = [];
      for (const { file, result } of inspected) {
        if (!result.ok) {
          results.push({ name: file.name, ok: false, error: result.error });
          continue;
        }
        const rel = await storeMedia(deps.uploadDir, userId, postId, file.bytes, result.ext);
        await copyToR2(deps.r2, rel, file.bytes, deps.logError);
        const media = insertMediaRow(
          deps.db,
          postId,
          next++,
          { path: rel, mime: result.mime, bytes: file.bytes.length },
          null,
        );
        results.push({ name: file.name, ok: true, media });
      }
      return { results };
    },

    detach(userId, postId, body) {
      const postRow = getPostRow(deps.db, userId, postId);
      if (!postRow) return null;
      if (postRow.status === 'published') throw new PostImmutableError(postId);

      const rows = mediaRowsForPost(deps.db, postId);
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

      removeMediaRows(
        deps.db,
        deleted.map((row) => row.id),
        kept,
      );
      let cleanupError: unknown;
      for (const row of deleted) {
        try {
          removeMedia(deps.uploadDir, row.path);
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (cleanupError !== undefined) throw cleanupError;
      return getPost(deps.db, userId, postId, deps.clock.now(), fileExists);
    },

    exists: fileExists,
  };
}
