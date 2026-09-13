import path from 'node:path';

import { parseServerEnv, r2ConfigFromEnv } from '../src/env';
import { createR2Client } from '../src/r2/client';
import { restoreUploads } from '../src/r2/restore';

const parsed = parseServerEnv(process.env);
if (!parsed.ok) {
  console.error(parsed.message);
  process.exit(1);
}
const r2Config = r2ConfigFromEnv(parsed.env);
if (!r2Config) {
  console.error('PERCH_R2_* must be set to restore');
  process.exit(1);
}

const uploadDir = path.resolve(parsed.env.PERCH_UPLOAD_DIR);
const restored = await restoreUploads(createR2Client(r2Config), uploadDir);
console.log(`restored ${restored} uploads to ${uploadDir}`);
