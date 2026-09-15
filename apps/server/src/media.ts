import { POST_MEDIA_MAX, type PostMediaAttachResponse } from '@perch/core';

import type { Clock } from './clock';
import type { Db } from './db';
import {
  getPostRow,
  insertMediaRow,
  insertPostLink,
  MediaLimitError,
  mediaRowsForPost,
  PostImmutableError,
} from './db/posts';
import { getResource } from './db/resources';
import { copyToR2, mediaFileExists, readMedia, storeMedia } from './images';
import type { R2Client } from './r2/client';

export interface MediaService {
  attachFromResources(
    userId: number,
    postId: number,
    ids: number[],
  ): Promise<PostMediaAttachResponse | null>;
  exists(rel: string): boolean;
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

    exists: fileExists,
  };
}
