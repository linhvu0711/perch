import fs from 'node:fs';
import path from 'node:path';

import type { R2Client } from './client';

/** Writes every `uploads/` object in the bucket back under uploadDir and returns the count. */
export async function restoreUploads(r2: R2Client, uploadDir: string): Promise<number> {
  let restored = 0;
  for (const key of await r2.list('uploads/')) {
    const rel = key.slice('uploads/'.length);
    if (rel.includes('..')) continue;
    const full = path.join(uploadDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    await Bun.write(full, await r2.get(key));
    restored += 1;
  }
  return restored;
}
