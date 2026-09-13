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

// Same shape as batchErrorSchema in ./resources; defined inline so this module
// never imports it (resources.ts imports tagNameSchema from here — a cycle).
const itemTagsErrorSchema = z.object({ code: z.string(), message: z.string() });

export const itemTagsBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(TAG_BATCH_MAX),
  tags: z.array(tagNameSchema).min(1).max(TAG_BATCH_MAX),
});
export type ItemTagsBody = z.infer<typeof itemTagsBodySchema>;

export const itemTagsResultSchema = z.discriminatedUnion('ok', [
  z.object({ id: z.number().int(), ok: z.literal(true), tags: z.array(z.string()) }),
  z.object({ id: z.number().int(), ok: z.literal(false), error: itemTagsErrorSchema }),
]);
export type ItemTagsResult = z.infer<typeof itemTagsResultSchema>;
export const itemTagsResponseSchema = z.object({ results: z.array(itemTagsResultSchema) });
export type ItemTagsResponse = z.infer<typeof itemTagsResponseSchema>;
