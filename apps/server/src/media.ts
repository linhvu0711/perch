import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  POST_MEDIA_MAX,
  type Post,
  type PostMedia,
  type PostMediaAttachResponse,
  type PostMediaDetachBody,
  type PostMediaFilesResponse,
} from '@perch/core';

import type { Clock } from './clock';
import type { Db } from './db';
import {
  getPost,
  getPostRow,
  insertMediaRows,
  MediaLimitError,
  mediaRowsForPost,
  PostImmutableError,
  type PostMediaRow,
  removeMediaRows,
} from './db/posts';
import { getResource } from './db/resources';
import { DomainError } from './errors';
import { copyToR2, inspectImage } from './images';
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
    inFlight: (id: number) => boolean,
  ): Promise<PostMediaAttachResponse | null>;
  attachFromFiles(
    userId: number,
    postId: number,
    files: MediaFileInput[],
    inFlight: (id: number) => boolean,
  ): Promise<PostMediaFilesResponse | null>;
  detach(userId: number, postId: number, body: PostMediaDetachBody): Post | null;
  readForSend(
    postId: number,
  ): Promise<Array<{ position: number; mime: PostMedia['mime']; bytes: Uint8Array | null }>>;
  exists(rel: string): boolean;
  removeAll(userId: number, postId: number): void;
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

function dirFor(uploadDir: string, userId: number, postId: number): string {
  return path.join(uploadDir, String(userId), 'posts', String(postId));
}

/** Writes a post-media copy under <uploadDir>/<userId>/posts/<postId>/ and returns the path relative to uploadDir. */
async function store(
  uploadDir: string,
  userId: number,
  postId: number,
  bytes: Uint8Array,
  ext: string,
  rels: string[],
): Promise<string> {
  const dir = dirFor(uploadDir, userId, postId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${ext}`;
  const rel = `${userId}/posts/${postId}/${name}`;
  rels.push(rel);
  await Bun.write(path.join(dir, name), bytes);
  return rel;
}

/** Reads bytes for a stored media path, or null when the file is gone. */
async function read(uploadDir: string, rel: string): Promise<Uint8Array | null> {
  const full = path.join(uploadDir, rel);
  return fs.existsSync(full) ? Bun.file(full).bytes() : null;
}

/** Deletes one media file and removes the post's media directory when empty. */
function remove(uploadDir: string, rel: string): void {
  const full = path.join(uploadDir, rel);
  fs.rmSync(full, { force: true });
  const dir = path.dirname(full);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

/** Deletes each media file, logging failures and continuing, so cleanup never masks an in-flight error. */
function discard(uploadDir: string, rels: string[], logError: (error: unknown) => void): void {
  for (const rel of rels) {
    try {
      remove(uploadDir, rel);
    } catch (error) {
      logError(error);
    }
  }
}

/** Deletes a post's whole media directory. */
function removeDir(uploadDir: string, userId: number, postId: number): void {
  fs.rmSync(dirFor(uploadDir, userId, postId), { recursive: true, force: true });
}

export function createMediaService(deps: {
  db: Db;
  uploadDir: string;
  r2: R2Client | null;
  clock: Clock;
  logError: (error: unknown) => void;
}): MediaService {
  const fileExists = (rel: string) => fs.existsSync(path.join(deps.uploadDir, rel));

  function refuseLateAttach(
    userId: number,
    postId: number,
    inFlight: (id: number) => boolean,
  ): void {
    if (inFlight(postId)) {
      throw new DomainError('in_flight', null, `Post ${postId} is being sent`);
    }
    const postRow = getPostRow(deps.db, userId, postId);
    if (!postRow || postRow.status === 'published') {
      throw new PostImmutableError(postId);
    }
  }

  return {
    async attachFromResources(userId, postId, ids, inFlight) {
      const postRow = getPostRow(deps.db, userId, postId);
      if (!postRow) return null;
      if (postRow.status === 'published') throw new PostImmutableError(postId);

      const existing = mediaRowsForPost(deps.db, postId);
      if (existing.length + ids.length > POST_MEDIA_MAX) {
        throw new MediaLimitError('resource_ids');
      }

      const results: PostMediaAttachResponse['results'] = [];
      const written: Array<{
        index: number;
        id: number;
        file: {
          path: string;
          mime: PostMedia['mime'];
          bytes: number;
          fromResourceId: number | null;
        };
      }> = [];
      const rels: string[] = [];
      try {
        for (const [index, id] of ids.entries()) {
          const resource = getResource(deps.db, userId, id);
          if (!resource) {
            results[index] = {
              id,
              ok: false,
              error: { code: 'not_found', message: `Resource ${id} not found` },
            };
            continue;
          }
          if (resource.type !== 'image') {
            results[index] = {
              id,
              ok: false,
              error: { code: 'not_image', message: `Resource ${id} is not an image` },
            };
            continue;
          }
          const bytes = await read(deps.uploadDir, resource.path);
          if (!bytes) {
            results[index] = {
              id,
              ok: false,
              error: { code: 'file_missing', message: 'Image file is missing' },
            };
            continue;
          }

          const ext = resource.path.split('.').pop() ?? 'png';
          const rel = await store(deps.uploadDir, userId, postId, bytes, ext, rels);
          await copyToR2(deps.r2, rel, bytes, deps.logError);
          written.push({
            index,
            id,
            file: {
              path: rel,
              mime: resource.mime,
              bytes: bytes.length,
              fromResourceId: id,
            },
          });
        }
        refuseLateAttach(userId, postId, inFlight);
        const inserted = insertMediaRows(
          deps.db,
          postId,
          existing.length + 1,
          written.map((item) => item.file),
          fileExists,
        );
        written.forEach((item, i) => {
          const media = inserted[i];
          if (media) results[item.index] = { id: item.id, ok: true, media };
        });
      } catch (error) {
        discard(deps.uploadDir, rels, deps.logError);
        throw error;
      }
      return { results };
    },

    async attachFromFiles(userId, postId, files, inFlight) {
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

      const results: PostMediaFilesResponse['results'] = [];
      const written: Array<{
        index: number;
        name: string;
        file: {
          path: string;
          mime: PostMedia['mime'];
          bytes: number;
          fromResourceId: number | null;
        };
      }> = [];
      const rels: string[] = [];
      try {
        for (const [index, { file, result }] of inspected.entries()) {
          if (!result.ok) {
            results[index] = { name: file.name, ok: false, error: result.error };
            continue;
          }
          const rel = await store(
            deps.uploadDir,
            userId,
            postId,
            file.bytes,
            result.ext,
            rels,
          );
          await copyToR2(deps.r2, rel, file.bytes, deps.logError);
          written.push({
            index,
            name: file.name,
            file: {
              path: rel,
              mime: result.mime,
              bytes: file.bytes.length,
              fromResourceId: null,
            },
          });
        }
        refuseLateAttach(userId, postId, inFlight);
        const inserted = insertMediaRows(
          deps.db,
          postId,
          existing.length + 1,
          written.map((item) => item.file),
          fileExists,
        );
        written.forEach((item, i) => {
          const media = inserted[i];
          if (media) results[item.index] = { name: item.name, ok: true, media };
        });
      } catch (error) {
        discard(deps.uploadDir, rels, deps.logError);
        throw error;
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
      for (const row of deleted) {
        try {
          remove(deps.uploadDir, row.path);
        } catch (error) {
          deps.logError(error);
        }
      }
      return getPost(deps.db, userId, postId, deps.clock.now(), fileExists);
    },

    async readForSend(postId) {
      const media = [];
      for (const row of mediaRowsForPost(deps.db, postId)) {
        media.push({
          position: row.position,
          mime: row.mime as PostMedia['mime'],
          bytes: await read(deps.uploadDir, row.path),
        });
      }
      return media;
    },

    exists: fileExists,

    removeAll(userId, postId) {
      removeDir(deps.uploadDir, userId, postId);
    },
  };
}
