import { timezoneSchema } from '@perch/core';
import { z } from 'zod';

import type { R2Config } from './r2/client';

const REQUIRED = { error: 'is required' };
const PORT_ERROR = { error: 'must be a whole number from 1 to 65535' };
const R2_TOGETHER =
  'PERCH_R2_ACCOUNT_ID, PERCH_R2_BUCKET, PERCH_R2_ACCESS_KEY_ID, and PERCH_R2_SECRET_ACCESS_KEY must be set together';

export const serverEnvSchema = z
  .object({
    PERCH_TOKEN: z.string(REQUIRED).min(1, REQUIRED),
    PERCH_SECURE_COOKIES: z
      .string()
      .default('true')
      .transform((v) => v.toLowerCase())
      .pipe(z.enum(['true', 'false'], { error: 'must be true or false' }))
      .transform((v) => v === 'true'),
    PERCH_DB_PATH: z.string().default('./data/perch.db'),
    PERCH_UPLOAD_DIR: z.string().default('./data/uploads'),
    PERCH_WEB_DIST: z.string().optional(),
    PORT: z.coerce
      .number(PORT_ERROR)
      .int(PORT_ERROR)
      .min(1, PORT_ERROR)
      .max(65_535, PORT_ERROR)
      .default(3000),
    PERCH_X_CLIENT_ID: z.string().optional(),
    PERCH_X_CLIENT_SECRET: z.string().optional(),
    PERCH_PUBLIC_URL: z.string().optional(),
    PERCH_TIMEZONE: timezoneSchema.default('UTC'),
    PERCH_R2_ACCOUNT_ID: z.string().optional(),
    PERCH_R2_BUCKET: z.string().optional(),
    PERCH_R2_ACCESS_KEY_ID: z.string().optional(),
    PERCH_R2_SECRET_ACCESS_KEY: z.string().optional(),
  })
  .refine(
    (env) =>
      [
        env.PERCH_R2_ACCOUNT_ID,
        env.PERCH_R2_BUCKET,
        env.PERCH_R2_ACCESS_KEY_ID,
        env.PERCH_R2_SECRET_ACCESS_KEY,
      ].every((value) => value !== undefined) ||
      [
        env.PERCH_R2_ACCOUNT_ID,
        env.PERCH_R2_BUCKET,
        env.PERCH_R2_ACCESS_KEY_ID,
        env.PERCH_R2_SECRET_ACCESS_KEY,
      ].every((value) => value === undefined),
    { message: R2_TOGETHER, path: ['PERCH_R2_BUCKET'] },
  );

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function r2ConfigFromEnv(env: ServerEnv): R2Config | null {
  const accountId = env.PERCH_R2_ACCOUNT_ID;
  const bucket = env.PERCH_R2_BUCKET;
  const accessKeyId = env.PERCH_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.PERCH_R2_SECRET_ACCESS_KEY;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

export function parseServerEnv(
  env: Record<string, string | undefined>,
): { ok: true; env: ServerEnv } | { ok: false; message: string } {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') clean[key] = value;
  }
  const result = serverEnvSchema.safeParse(clean);
  if (!result.success) {
    const issue = result.error.issues[0];
    if (!issue) return { ok: false, message: 'invalid environment' };
    return { ok: false, message: `${issue.path.join('.')} ${issue.message}` };
  }
  return { ok: true, env: result.data };
}
