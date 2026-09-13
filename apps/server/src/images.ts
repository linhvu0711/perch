import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { IMAGE_BYTES_MAX, type ImageResource } from '@perch/core';

type Mime = ImageResource['mime'];

const EXT_BY_FORMAT = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif' } as const;
const MIME_BY_FORMAT = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
} as const satisfies Record<string, Mime>;

export type InspectedImage = {
  ok: true;
  mime: Mime;
  width: number;
  height: number;
  ext: string;
};

export async function inspectImage(
  bytes: Uint8Array,
): Promise<InspectedImage | { ok: false; error: { code: string; message: string } }> {
  if (bytes.length > IMAGE_BYTES_MAX) {
    return { ok: false, error: { code: 'too_large', message: 'Over 5 MB' } };
  }

  let format: string;
  let width: number;
  let height: number;
  try {
    const metadata = await new Bun.Image(bytes).metadata();
    format = metadata.format;
    width = metadata.width;
    height = metadata.height;
  } catch {
    return {
      ok: false,
      error: { code: 'bad_type', message: 'Only PNG, JPG, WebP, or GIF' },
    };
  }

  if (!(format in EXT_BY_FORMAT)) {
    return {
      ok: false,
      error: { code: 'bad_type', message: 'Only PNG, JPG, WebP, or GIF' },
    };
  }

  const known = format as keyof typeof EXT_BY_FORMAT;
  return {
    ok: true,
    mime: MIME_BY_FORMAT[known],
    width,
    height,
    ext: EXT_BY_FORMAT[known],
  };
}

export async function storeImage(
  uploadDir: string,
  userId: number,
  bytes: Uint8Array,
  ext: string,
): Promise<string> {
  fs.mkdirSync(path.join(uploadDir, String(userId)), { recursive: true });
  const rel = `${userId}/${crypto.randomUUID()}.${ext}`;
  await Bun.write(path.join(uploadDir, rel), bytes);
  return rel;
}

export function removeImage(uploadDir: string, rel: string): void {
  fs.rmSync(path.join(uploadDir, rel), { force: true });
}
