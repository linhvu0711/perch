import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const settings = sqliteTable('settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id),
  timezone: text('timezone').notNull().default('UTC'),
  charLimitOverride: integer('char_limit_override'),
});

export const resources = sqliteTable(
  'resources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type', { enum: ['tweet', 'image', 'md'] }).notNull(),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    mdBody: text('md_body'),
  },
  (t) => [index('resources_user_created_idx').on(t.userId, t.createdAt, t.id)],
);
