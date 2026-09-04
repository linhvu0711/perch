import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { migrateDb, openDb, seedDb } from '../src/db';
import { getSettings, updateSettings } from '../src/db/settings';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('database', () => {
  test('migrates, seeds idempotently, and filters settings by user', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perch-db-test-'));
    const { db, sqlite } = openDb(path.join(dir, 'perch.db'));
    cleanup = () => {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    };

    migrateDb(db);
    const now = new Date('2026-09-04T10:00:00Z');
    seedDb(db, now);
    seedDb(db, now);

    expect(getSettings(db, 1)).toEqual({
      timezone: 'UTC',
      char_limit_override: null,
    });
    expect(updateSettings(db, 1, { timezone: 'Europe/Berlin' })).toEqual({
      timezone: 'Europe/Berlin',
      char_limit_override: null,
    });
    expect(getSettings(db, 1).timezone).toBe('Europe/Berlin');
    expect(() => getSettings(db, 2)).toThrow('settings row missing');
  });
});
