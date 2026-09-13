import { z } from 'zod';

export const TAG_NAME_MAX = 50;
export const TAG_BATCH_MAX = 100;

export const tagNameSchema = z.string().trim().min(1).max(TAG_NAME_MAX);

export const tagSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  resource_count: z.number().int().nonnegative(),
  post_count: z.number().int().nonnegative(),
});
export type Tag = z.infer<typeof tagSchema>;

export const tagListSchema = z.object({
  items: z.array(tagSchema),
  total: z.number().int().nonnegative(),
  next_cursor: z.string().nullable(),
});
export type TagList = z.infer<typeof tagListSchema>;

export const tagCreateSchema = z.object({ name: tagNameSchema });
export type TagCreate = z.infer<typeof tagCreateSchema>;
