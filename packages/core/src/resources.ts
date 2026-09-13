import { z } from 'zod';

import { isValidDate } from './timezone';

export const RESOURCE_TYPES = ['tweet', 'image', 'md'] as const;
export const resourceTypeSchema = z.enum(RESOURCE_TYPES);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

export const NOTE_TITLE_FALLBACK = 'Untitled';
export const RESOURCE_TITLE_MAX = 200;
export const RESOURCE_NOTES_MAX = 10_000;
export const NOTE_BODY_MAX = 1_000_000;
export const RESOURCE_LIST_LIMIT_DEFAULT = 50;
export const RESOURCE_LIST_LIMIT_MAX = 100;
export const RESOURCE_BATCH_MAX = 100;

export const noteResourceSchema = z.object({
  id: z.number().int().positive(),
  type: z.literal('md'),
  title: z.string(),
  notes: z.string(),
  created_at: z.string(),
  body: z.string(),
  used_by: z.number().int().nonnegative().optional(),
  tags: z.array(z.string()),
});
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const IMAGE_BYTES_MAX = 5 * 1024 * 1024;
export const imageResourceSchema = z.object({
  id: z.number().int().positive(),
  type: z.literal('image'),
  title: z.string(),
  notes: z.string(),
  created_at: z.string(),
  path: z.string(),
  mime: z.enum(IMAGE_MIME_TYPES),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  used_by: z.number().int().nonnegative().optional(),
  tags: z.array(z.string()),
});
export const tweetResourceSchema = z.object({
  id: z.number().int().positive(),
  type: z.literal('tweet'),
  title: z.string(),
  notes: z.string(),
  created_at: z.string(),
  url: z.string().url(),
  x_id: z.string(),
  author_id: z.string(),
  author_username: z.string(),
  text: z.string(),
  posted_at: z.string(),
  used_by: z.number().int().nonnegative().optional(),
  tags: z.array(z.string()),
});
export const resourceSchema = z.discriminatedUnion('type', [
  noteResourceSchema,
  imageResourceSchema,
  tweetResourceSchema,
]);
export type Resource =
  | z.infer<typeof noteResourceSchema>
  | (z.infer<typeof imageResourceSchema> & { body?: undefined })
  | (z.infer<typeof tweetResourceSchema> & { body?: undefined });
export type NoteResource = z.infer<typeof noteResourceSchema>;
export type ImageResource = z.infer<typeof imageResourceSchema>;
export type TweetResource = z.infer<typeof tweetResourceSchema>;

export const noteCreateSchema = z
  .object({
    title: z.string().trim().max(RESOURCE_TITLE_MAX).optional(),
    notes: z.string().max(RESOURCE_NOTES_MAX).optional(),
    body: z.string().max(NOTE_BODY_MAX),
  })
  .superRefine((value, context) => {
    if (noteTitle(value.body, value.title).length > RESOURCE_TITLE_MAX) {
      context.addIssue({
        code: 'custom',
        path: ['title'],
        message: `Title must contain at most ${RESOURCE_TITLE_MAX} characters`,
      });
    }
  });
export type NoteCreate = z.infer<typeof noteCreateSchema>;

export const resourcePatchSchema = z
  .object({
    title: z.string().trim().min(1).max(RESOURCE_TITLE_MAX).optional(),
    notes: z.string().max(RESOURCE_NOTES_MAX).optional(),
    body: z.string().max(NOTE_BODY_MAX).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type ResourcePatch = z.infer<typeof resourcePatchSchema>;

export const resourceListQuerySchema = z.object({
  type: resourceTypeSchema.optional(),
  search: z.string().trim().max(200).optional(),
  author: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .transform((value) => value.replace(/^@/, ''))
    .optional(),
  from: z.string().refine(isValidDate, 'Use YYYY-MM-DD').optional(),
  to: z.string().refine(isValidDate, 'Use YYYY-MM-DD').optional(),
  sort: z.enum(['created', 'used']).default('created'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(RESOURCE_LIST_LIMIT_MAX)
    .default(RESOURCE_LIST_LIMIT_DEFAULT),
  cursor: z.string().min(1).optional(),
});
export type ResourceListQuery = z.infer<typeof resourceListQuerySchema>;

export const resourceListSchema = z.object({
  items: z.array(resourceSchema),
  total: z.number().int().nonnegative(),
  next_cursor: z.string().nullable(),
});
export type ResourceList = z.infer<typeof resourceListSchema>;

export const resourceAuthorsSchema = z.object({
  authors: z.array(z.object({ username: z.string(), count: z.number().int() })),
});
export type ResourceAuthors = z.infer<typeof resourceAuthorsSchema>;

export const resourceDeleteBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(RESOURCE_BATCH_MAX),
});
export type ResourceDeleteBody = z.infer<typeof resourceDeleteBodySchema>;

export const batchErrorSchema = z.object({ code: z.string(), message: z.string() });
export const resourceDeleteResultSchema = z.discriminatedUnion('ok', [
  z.object({
    id: z.number().int(),
    ok: z.literal(true),
    unlinked_post_ids: z.array(z.number().int()),
  }),
  z.object({ id: z.number().int(), ok: z.literal(false), error: batchErrorSchema }),
]);
export const resourceDeleteResponseSchema = z.object({
  results: z.array(resourceDeleteResultSchema),
});
export type ResourceDeleteResult = z.infer<typeof resourceDeleteResultSchema>;
export type ResourceDeleteResponse = z.infer<typeof resourceDeleteResponseSchema>;

export const imageCreateResponseSchema = z.object({
  results: z.array(
    z.discriminatedUnion('ok', [
      z.object({
        name: z.string(),
        ok: z.literal(true),
        resource: imageResourceSchema,
      }),
      z.object({
        name: z.string(),
        ok: z.literal(false),
        error: batchErrorSchema,
      }),
    ]),
  ),
});
export type ImageCreateResponse = z.infer<typeof imageCreateResponseSchema>;

export const tweetCreateSchema = z.object({
  urls: z.array(z.string().trim().min(1)).min(1).max(RESOURCE_BATCH_MAX),
  refresh: z.boolean().default(false),
});
export type TweetCreate = z.infer<typeof tweetCreateSchema>;

export const tweetCreateResultSchema = z.discriminatedUnion('ok', [
  z.object({
    url: z.string(),
    ok: z.literal(true),
    status: z.enum(['created', 'existing', 'refreshed']),
    resource: tweetResourceSchema,
  }),
  z.object({
    url: z.string(),
    ok: z.literal(false),
    error: batchErrorSchema,
  }),
]);
export type TweetCreateResult = z.infer<typeof tweetCreateResultSchema>;
export const tweetCreateResponseSchema = z.object({
  results: z.array(tweetCreateResultSchema),
});
export type TweetCreateResponse = z.infer<typeof tweetCreateResponseSchema>;

/** First ATX heading (`#` to `######`) outside fenced code blocks, trimmed, closing #s removed; null when none. */
export function firstMarkdownHeading(body: string): string | null {
  let insideFence = false;

  for (const rawLine of body.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;

    const match = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (!match) continue;
    const heading = match[2]?.trim();
    if (heading && !/^#+$/.test(heading)) return heading;
  }

  return null;
}

/** explicit?.trim() when non-empty, else firstMarkdownHeading(body), else NOTE_TITLE_FALLBACK. */
export function noteTitle(body: string, explicit?: string): string {
  const title = explicit?.trim();
  return title || firstMarkdownHeading(body) || NOTE_TITLE_FALLBACK;
}
