import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { parseServerEnv, r2ConfigFromEnv, serverEnvSchema } from '../src/env';

describe('parseServerEnv', () => {
  test('parses a valid env with defaults', () => {
    // Given: { PERCH_TOKEN: 'secret' }
    // When: parseServerEnv(...)
    // Then: { ok: true, env: { PERCH_TOKEN: 'secret', PERCH_SECURE_COOKIES: true, PERCH_DB_PATH: './data/perch.db', PERCH_UPLOAD_DIR: './data/uploads', PORT: 3000, PERCH_TIMEZONE: 'UTC' } }
    expect(parseServerEnv({ PERCH_TOKEN: 'secret' })).toEqual({
      ok: true,
      env: {
        PERCH_TOKEN: 'secret',
        PERCH_SECURE_COOKIES: true,
        PERCH_DB_PATH: './data/perch.db',
        PERCH_UPLOAD_DIR: './data/uploads',
        PORT: 3000,
        PERCH_TIMEZONE: 'UTC',
      },
    });
  });

  test('rejects an unknown PERCH_TIMEZONE', () => {
    // Given: { PERCH_TOKEN: 'secret', PERCH_TIMEZONE: 'Mars/Olympus' }
    // When: parseServerEnv(...)
    // Then: { ok: false, message: 'PERCH_TIMEZONE Unknown time zone' }
    expect(parseServerEnv({ PERCH_TOKEN: 'secret', PERCH_TIMEZONE: 'Mars/Olympus' })).toEqual({
      ok: false,
      message: 'PERCH_TIMEZONE Unknown time zone',
    });
  });

  test('accepts the four R2 variables together', () => {
    // Given: all four PERCH_R2_* variables set
    // When: parseServerEnv(...)
    const result = parseServerEnv({
      PERCH_TOKEN: 'secret',
      PERCH_R2_ACCOUNT_ID: 'acct',
      PERCH_R2_BUCKET: 'perch',
      PERCH_R2_ACCESS_KEY_ID: 'key',
      PERCH_R2_SECRET_ACCESS_KEY: 'secret',
    });
    // Then: ok and r2ConfigFromEnv returns the typed config
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(r2ConfigFromEnv(result.env)).toEqual({
      accountId: 'acct',
      bucket: 'perch',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });
  });

  test('rejects a partial R2 config', () => {
    // Given: { PERCH_TOKEN: 'secret', PERCH_R2_BUCKET: 'perch' }
    // When: parseServerEnv(...)
    // Then: { ok: false, message: 'PERCH_R2_BUCKET ... must be set together' }
    expect(parseServerEnv({ PERCH_TOKEN: 'secret', PERCH_R2_BUCKET: 'perch' })).toEqual({
      ok: false,
      message:
        'PERCH_R2_BUCKET PERCH_R2_ACCOUNT_ID, PERCH_R2_BUCKET, PERCH_R2_ACCESS_KEY_ID, and PERCH_R2_SECRET_ACCESS_KEY must be set together',
    });
  });

  test('documents every server variable in .env.example and the README', () => {
    // Given: every key in serverEnvSchema and the text of .env.example and README.md
    const root = path.resolve(import.meta.dir, '../../..');
    const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    // When: each key is looked up as `KEY=` in .env.example and `KEY` in README.md
    // Then: every key is found in both files
    for (const key of Object.keys(serverEnvSchema.shape)) {
      expect(envExample, `${key} missing from .env.example`).toMatch(
        new RegExp(`^#?\\s*${key}=`, 'm'),
      );
      expect(readme, `${key} missing from README.md`).toContain(`\`${key}\``);
    }
  });

  test('rejects PORT that is not a number', () => {
    // Given: { PERCH_TOKEN: 'secret', PORT: 'abc' }
    // When: parseServerEnv(...)
    // Then: { ok: false, message: 'PORT must be a whole number from 1 to 65535' }
    expect(parseServerEnv({ PERCH_TOKEN: 'secret', PORT: 'abc' })).toEqual({
      ok: false,
      message: 'PORT must be a whole number from 1 to 65535',
    });
  });

  test('rejects PERCH_SECURE_COOKIES outside true or false', () => {
    // Given: { PERCH_TOKEN: 'secret', PERCH_SECURE_COOKIES: 'maybe' }
    // When: parseServerEnv(...)
    // Then: { ok: false, message: 'PERCH_SECURE_COOKIES must be true or false' }
    expect(parseServerEnv({ PERCH_TOKEN: 'secret', PERCH_SECURE_COOKIES: 'maybe' })).toEqual({
      ok: false,
      message: 'PERCH_SECURE_COOKIES must be true or false',
    });
  });

  test('rejects a missing PERCH_TOKEN', () => {
    // Given: {}
    // When: parseServerEnv(...)
    // Then: { ok: false, message: 'PERCH_TOKEN is required' }
    expect(parseServerEnv({})).toEqual({
      ok: false,
      message: 'PERCH_TOKEN is required',
    });
  });
});
