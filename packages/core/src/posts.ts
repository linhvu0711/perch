import { z } from 'zod';

import { resourceTypeSchema } from './resources';

export const POST_STATUSES = ['draft', 'official', 'published', 'failed'] as const;
export const postStatusSchema = z.enum(POST_STATUSES);
export type PostStatus = z.infer<typeof postStatusSchema>;

export const POST_TITLE_MAX = 200;
export const POST_TEXT_MAX = 100_000;
export const POST_BATCH_MAX = 100;
export const POST_LIST_LIMIT_DEFAULT = 50;
export const POST_LIST_LIMIT_MAX = 100;

export const postLinkSchema = z.object({
  resource_id: z.number().int(),
  type: resourceTypeSchema,
  title: z.string(),
});
export type PostLink = z.infer<typeof postLinkSchema>;

export const postSchema = z.object({
  id: z.number().int(),
  status: postStatusSchema,
  title: z.string(),
  text: z.string(),
  scheduled_at: z.string().nullable(),
  published_at: z.string().nullable(),
  x_account_id: z.number().int().nullable(),
  x_post_id: z.string().nullable(),
  last_error: z.string().nullable(),
  retry_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  character_count: z.number().int(),
  limit: z.number().int(),
  estimated_cost: z.number(),
  links: z.array(postLinkSchema),
  media: z.array(z.never()),
});
export type Post = z.infer<typeof postSchema>;

export const postCreateSchema = z.object({
  title: z.string().trim().max(POST_TITLE_MAX).optional(),
  text: z.string().max(POST_TEXT_MAX).optional(),
  from: z.array(z.number().int().positive()).max(POST_BATCH_MAX).optional(),
});
export type PostCreate = z.infer<typeof postCreateSchema>;
