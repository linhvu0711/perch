import { z } from 'zod';

import { xAccountSchema } from './api';
import { postSchema } from './posts';

export const STATUS_NEXT_DUE = 5;
export const STATUS_WEEK_DAYS = 7;
export const STATUS_WEEK_MS = STATUS_WEEK_DAYS * 86_400_000;

export const statusSchema = z.object({
  timezone: z.string(),
  account: xAccountSchema.nullable(),
  next_due: z.array(postSchema),
  next_official: postSchema.nullable(),
  missed_count: z.number().int().nonnegative(),
  failed_count: z.number().int().nonnegative(),
  due_soon_count: z.number().int().nonnegative(),
  week_official_count: z.number().int().nonnegative(),
  week_draft_count: z.number().int().nonnegative(),
  month_cost_usd: z.number(),
});
export type Status = z.infer<typeof statusSchema>;
