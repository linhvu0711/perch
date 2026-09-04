import { describe, expect, test } from 'bun:test';

import { settingsPatchSchema } from '../src/api';

describe('settingsPatchSchema', () => {
  test('rejects an empty patch', () => {
    expect(settingsPatchSchema.safeParse({}).success).toBe(false);
  });

  test('accepts a time zone patch', () => {
    expect(settingsPatchSchema.safeParse({ timezone: 'UTC' }).success).toBe(true);
  });

  test('enforces character limit bounds', () => {
    expect(settingsPatchSchema.safeParse({ char_limit_override: 0 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ char_limit_override: 25_001 }).success).toBe(false);
  });

  test('accepts clearing the character limit override', () => {
    expect(settingsPatchSchema.safeParse({ char_limit_override: null }).success).toBe(true);
  });
});
