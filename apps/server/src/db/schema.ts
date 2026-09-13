import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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
    imagePath: text('image_path'),
    imageMime: text('image_mime'),
    imageBytes: integer('image_bytes'),
    imageWidth: integer('image_w'),
    imageHeight: integer('image_h'),
  },
  (t) => [index('resources_user_created_idx').on(t.userId, t.createdAt, t.id)],
);

export const xAccounts = sqliteTable(
  'x_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    xUserId: text('x_user_id').notNull(),
    username: text('username').notNull(),
    subscriptionType: text('subscription_type').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    connectedAt: integer('connected_at', { mode: 'timestamp_ms' }).notNull(),
    disconnectedAt: integer('disconnected_at', { mode: 'timestamp_ms' }),
    reconnectRequired: integer('reconnect_required', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (t) => [uniqueIndex('x_accounts_user_x_user_idx').on(t.userId, t.xUserId)],
);

export const apiCalls = sqliteTable('api_calls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  endpoint: text('endpoint').notNull(),
  costUsd: real('cost_usd').notNull(),
  postId: integer('post_id'),
  resourceId: integer('resource_id'),
  xAccountId: integer('x_account_id').references(() => xAccounts.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
