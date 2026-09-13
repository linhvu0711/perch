import { z } from 'zod';

import { POST_MEDIA_MAX, readySchema } from './postRules';
import { batchErrorSchema, IMAGE_MIME_TYPES, resourceTypeSchema } from './resources';
import { isCalendarDate } from './schedule';
import { TAG_BATCH_MAX, tagFilterSchema, tagNameSchema } from './tags';

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

export { POST_MEDIA_MAX };

export const postMediaSchema = z.object({
  id: z.number().int(),
  position: z.number().int().min(1).max(POST_MEDIA_MAX),
  mime: z.enum(IMAGE_MIME_TYPES),
  bytes: z.number().int(),
  from_resource_id: z.number().int().nullable(),
});
export type PostMedia = z.infer<typeof postMediaSchema>;

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
  tags: z.array(z.string()),
  media: z.array(postMediaSchema),
  ready: readySchema,
});
export type Post = z.infer<typeof postSchema>;

export const postCreateSchema = z.object({
  title: z.string().trim().max(POST_TITLE_MAX).optional(),
  text: z.string().max(POST_TEXT_MAX).optional(),
  from: z.array(z.number().int().positive()).max(POST_BATCH_MAX).optional(),
  tags: z.array(tagNameSchema).max(TAG_BATCH_MAX).optional(),
  official: z.boolean().optional(),
});
export type PostCreate = z.infer<typeof postCreateSchema>;

const listDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => {
      const [year, month, day] = value.split('-').map(Number) as [number, number, number];
      return isCalendarDate(year, month, day);
    },
    { message: 'Invalid calendar date' },
  );

export const postListQuerySchema = z.object({
  status: postStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
  from: listDateSchema.optional(),
  to: listDateSchema.optional(),
  resource_id: z.coerce.number().int().positive().optional(),
  tag: tagFilterSchema,
  scheduled: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(POST_LIST_LIMIT_MAX).default(POST_LIST_LIMIT_DEFAULT),
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

export const postMediaAttachBodySchema = z
  .object({
    resource_ids: z.array(z.number().int().positive()).min(1).max(POST_MEDIA_MAX),
  })
  .strict();
export type PostMediaAttachBody = z.infer<typeof postMediaAttachBodySchema>;

export const postMediaAttachResultSchema = z.discriminatedUnion('ok', [
  z.object({ id: z.number().int(), ok: z.literal(true), media: postMediaSchema }),
  z.object({
    id: z.number().int(),
    ok: z.literal(false),
    error: batchErrorSchema,
  }),
]);
export const postMediaAttachResponseSchema = z.object({
  results: z.array(postMediaAttachResultSchema),
});
export type PostMediaAttachResult = z.infer<typeof postMediaAttachResultSchema>;
export type PostMediaAttachResponse = z.infer<typeof postMediaAttachResponseSchema>;

export const postMediaFileResultSchema = z.discriminatedUnion('ok', [
  z.object({ name: z.string(), ok: z.literal(true), media: postMediaSchema }),
  z.object({ name: z.string(), ok: z.literal(false), error: batchErrorSchema }),
]);
export const postMediaFilesResponseSchema = z.object({
  results: z.array(postMediaFileResultSchema),
});
export type PostMediaFileResult = z.infer<typeof postMediaFileResultSchema>;
export type PostMediaFilesResponse = z.infer<typeof postMediaFilesResponseSchema>;

export const postMediaDetachBodySchema = z.union([
  z
    .object({
      positions: z.array(z.number().int().min(1).max(POST_MEDIA_MAX)).min(1),
    })
    .strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export type PostMediaDetachBody = z.infer<typeof postMediaDetachBodySchema>;

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

export const postIdsBodySchema = postDeleteBodySchema;
export type PostIdsBody = z.infer<typeof postIdsBodySchema>;

export const postStatusResultSchema = z.discriminatedUnion('ok', [
  z.object({ id: z.number().int(), ok: z.literal(true) }),
  z.object({
    id: z.number().int(),
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    }),
  }),
]);
export const postStatusResponseSchema = z.object({
  results: z.array(postStatusResultSchema),
});
export type PostStatusResult = z.infer<typeof postStatusResultSchema>;
export type PostStatusResponse = z.infer<typeof postStatusResponseSchema>;

export const postScheduleBodySchema = z.object({
  at: z.string().trim().min(1),
  force: z.boolean().optional(),
});
export type PostScheduleBody = z.infer<typeof postScheduleBodySchema>;

export const previewSegmentSchema = z.object({
  kind: z.enum(['text', 'url', 'mention', 'hashtag']),
  text: z.string(),
});

export const postPreviewSchema = z.object({
  segments: z.array(previewSegmentSchema),
  character_count: z.number().int(),
  limit: z.number().int(),
  estimated_cost: z.number(),
});
export type PostPreview = z.infer<typeof postPreviewSchema>;

/** Title shown in lists: the stored title, else the first line of the text. */
export function postListTitle(title: string, text: string): string {
  if (title !== '') return title;
  return (text.split('\n', 1)[0] ?? '').trim();
}
