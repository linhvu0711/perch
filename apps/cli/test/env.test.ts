import { describe, expect, test } from 'bun:test';

import { parseCliEnv } from '../src/env';
import { CliError } from '../src/output';

describe('parseCliEnv', () => {
  test('parses a valid env', () => {
    // Given: { PERCH_TOKEN: 't', PERCH_SERVER_URL: 'http://localhost:3000', VISUAL: 'vim' }
    // When: parseCliEnv(...)
    // Then: toEqual the same object
    expect(
      parseCliEnv({
        PERCH_TOKEN: 't',
        PERCH_SERVER_URL: 'http://localhost:3000',
        VISUAL: 'vim',
      }),
    ).toEqual({
      PERCH_TOKEN: 't',
      PERCH_SERVER_URL: 'http://localhost:3000',
      VISUAL: 'vim',
    });
  });

  test('rejects PERCH_SERVER_URL that is not a URL', () => {
    // Given: { PERCH_SERVER_URL: 'notaurl' }
    // When: parseCliEnv(...)
    // Then: throws a CliError with code 'usage', exitCode 2, message 'PERCH_SERVER_URL must be a URL'
    let error: unknown;
    try {
      parseCliEnv({ PERCH_SERVER_URL: 'notaurl' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CliError);
    expect(error).toMatchObject({
      code: 'usage',
      exitCode: 2,
      message: 'PERCH_SERVER_URL must be a URL',
    });
  });

  test('drops unknown and empty variables', () => {
    // Given: { PATH: '/bin', PERCH_TOKEN: '' }
    // When: parseCliEnv(...)
    // Then: toEqual({})
    expect(parseCliEnv({ PATH: '/bin', PERCH_TOKEN: '' })).toEqual({});
  });
});
