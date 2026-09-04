import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import path from 'node:path';

import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';

import * as schema from './schema';

export type Db = BunSQLiteDatabase<typeof schema>;

export function openDb(dbPath: string): { db: Db; sqlite: Database } {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath, { create: true });
  sqlite.exec('PRAGMA journal_mode = WAL;');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function migrateDb(db: Db): void {
  migrate(db, {
    migrationsFolder: path.resolve(import.meta.dir, '../../drizzle'),
  });
}

export function seedDb(db: Db, now: Date): void {
  db.insert(schema.users)
    .values({ id: 1, createdAt: now })
    .onConflictDoNothing()
    .run();
  db.insert(schema.settings)
    .values({ userId: 1, timezone: 'UTC', charLimitOverride: null })
    .onConflictDoNothing()
    .run();
}
