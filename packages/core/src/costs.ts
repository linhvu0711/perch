import { z } from 'zod';

/** Every X price Perch pays. Change a price here; nothing else holds one. */
export const X_COSTS_USD = {
  getMe: 0.01,
  getTweet: 0.005,
  getTweetAuthor: 0.01,
  // One post read plus one expanded author user read; a literal so the sum stays exact.
  saveTweet: 0.015,
  publish: 0.015,
  publishWithUrl: 0.2,
  mediaUpload: 0,
} as const;

export const X_ENDPOINTS = {
  getMe: 'GET /2/users/me',
  getTweet: 'GET /2/tweets/:id',
  createPost: 'POST /2/tweets',
  uploadMedia: 'POST /2/media/upload',
} as const;

export const COST_KINDS = ['publish', 'save_tweet', 'connect'] as const;
export type CostKind = (typeof COST_KINDS)[number];

/** The cost bucket an api_calls endpoint belongs to. */
export function costKindOf(endpoint: string): CostKind {
  switch (endpoint) {
    case X_ENDPOINTS.createPost:
    case X_ENDPOINTS.uploadMedia:
      return 'publish';
    case X_ENDPOINTS.getTweet:
      return 'save_tweet';
    case X_ENDPOINTS.getMe:
      return 'connect';
    default:
      throw new Error(`Unknown X endpoint ${endpoint}`);
  }
}

export const COST_MONTHS_LIMIT_DEFAULT = 6;
export const COST_MONTHS_LIMIT_MAX = 100;

export const costMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export type CostMonth = z.infer<typeof costMonthSchema>;

export const costMonthRowSchema = z.object({
  month: costMonthSchema,
  calls: z.number().int().nonnegative(),
  publish_usd: z.number(),
  save_tweet_usd: z.number(),
  connect_usd: z.number(),
  total_usd: z.number(),
});
export type CostMonthRow = z.infer<typeof costMonthRowSchema>;

export const costSummarySchema = costMonthRowSchema.extend({ all_time_usd: z.number() });
export type CostSummary = z.infer<typeof costSummarySchema>;

export const costSummaryQuerySchema = z.object({ month: costMonthSchema.optional() });
export type CostSummaryQuery = z.infer<typeof costSummaryQuerySchema>;

export const costHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(COST_MONTHS_LIMIT_MAX).default(COST_MONTHS_LIMIT_DEFAULT),
  cursor: z.string().min(1).optional(),
});
export type CostHistoryQuery = z.infer<typeof costHistoryQuerySchema>;

export const costHistorySchema = z.object({
  items: z.array(costMonthRowSchema),
  total: z.number().int(),
  next_cursor: z.string().nullable(),
});
export type CostHistory = z.infer<typeof costHistorySchema>;
