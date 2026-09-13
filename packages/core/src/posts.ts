import { z } from 'zod';

import { batchErrorSchema, resourceTypeSchema } from './resources';

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

const listDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const postListQuerySchema = z.object({
  status: postStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
  from: listDateSchema.optional(),
  to: listDateSchema.optional(),
  resource_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(POST_LIST_LIMIT_MAX)
    .default(POST_LIST_LIMIT_DEFAULT),
  cursor: z.string().min(1).optional(),
});
export type PostListQuery = z.infer<typeof postListQuerySchema>;

export const postListSchema = z.object({
  items: z.array(postSchema),
  total: z.number().int().nonnegative(),
  next_cursor: z.string().nullable(),
});
export type PostList = z.infer<typeof postListSchema>;

export const postPatchSchema = z
  .object({
    title: z.string().trim().max(POST_TITLE_MAX).optional(),
    text: z.string().max(POST_TEXT_MAX).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update',
  });
export type PostPatch = z.infer<typeof postPatchSchema>;

export const postLinksBodySchema = z.object({
  resource_ids: z.array(z.number().int().positive()).min(1).max(POST_BATCH_MAX),
});
export type PostLinksBody = z.infer<typeof postLinksBodySchema>;

export const postLinkResultSchema = z.discriminatedUnion('ok', [
  z.object({ id: z.number().int(), ok: z.literal(true) }),
  z.object({
    id: z.number().int(),
    ok: z.literal(false),
    error: batchErrorSchema,
  }),
]);
export const postLinksResponseSchema = z.object({
  results: z.array(postLinkResultSchema),
});
export type PostLinkResult = z.infer<typeof postLinkResultSchema>;
export type PostLinksResponse = z.infer<typeof postLinksResponseSchema>;

export const postDeleteBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(POST_BATCH_MAX),
});
export type PostDeleteBody = z.infer<typeof postDeleteBodySchema>;

export const postDeleteResultSchema = z.discriminatedUnion('ok', [
  z.object({ id: z.number().int(), ok: z.literal(true) }),
  z.object({
    id: z.number().int(),
    ok: z.literal(false),
    error: batchErrorSchema,
  }),
]);
export const postDeleteResponseSchema = z.object({
  results: z.array(postDeleteResultSchema),
});
export type PostDeleteResponse = z.infer<typeof postDeleteResponseSchema>;

/** Title shown in lists: the stored title, else the first line of the text. */
export function postListTitle(title: string, text: string): string {
  if (title !== '') return title;
  return (text.split('\n', 1)[0] ?? '').trim();
}
