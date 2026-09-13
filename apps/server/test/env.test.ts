import { describe, expect, test } from 'bun:test';

import { parseServerEnv } from '../src/env';

describe('parseServerEnv', () => {
  test('parses a valid env with defaults', () => {
    // Given: { PERCH_TOKEN: 'secret' }
    // When: parseServerEnv(...)
    // Then: { ok: true, env: { PERCH_TOKEN: 'secret', PERCH_SECURE_COOKIES: true, PERCH_DB_PATH: './data/perch.db', PERCH_UPLOAD_DIR: './data/uploads', PORT: 3000 } }
    expect(parseServerEnv({ PERCH_TOKEN: 'secret' })).toEqual({
      ok: true,
      env: {
        PERCH_TOKEN: 'secret',
        PERCH_SECURE_COOKIES: true,
        PERCH_DB_PATH: './data/perch.db',
        PERCH_UPLOAD_DIR: './data/uploads',
        PORT: 3000,
      },
    });
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
    expect(
      parseServerEnv({ PERCH_TOKEN: 'secret', PERCH_SECURE_COOKIES: 'maybe' }),
    ).toEqual({
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
