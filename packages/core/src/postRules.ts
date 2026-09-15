import { z } from 'zod';

import { weightedLength } from './charCount';

export const POST_MEDIA_MAX = 4;
export const PROMOTE_FROM = ['draft'] as const;
export const DEMOTE_FROM = ['official', 'failed'] as const;
export const SCHEDULE_FROM = ['draft', 'official'] as const;
export const PUBLISH_FROM = ['draft', 'official'] as const;
export const RETRY_FROM = ['failed'] as const;
export const RETRY_DELAYS_MS = [60_000, 300_000, 900_000] as const;

/** The time of the next send attempt after a failure, or null when no retry is left. */
export function nextAttemptAt(scheduledAt: Date, failedAttempts: number): Date | null {
  const delay = RETRY_DELAYS_MS[failedAttempts - 1];
  if (delay === undefined) {
    return null;
  }
  return new Date(scheduledAt.getTime() + delay);
}

export const readyCheckSchema = z.object({
  code: z.enum(['text', 'limit', 'media', 'account']),
  ok: z.boolean(),
  label: z.string(),
});
export type ReadyCheck = z.infer<typeof readyCheckSchema>;

export const readySchema = z.object({
  ok: z.boolean(),
  checks: z.array(readyCheckSchema),
});
export type Ready = z.infer<typeof readySchema>;

export interface PostChecksInput {
  text: string;
  limit: number;
  media: Array<{ position: number; present: boolean }>;
  accountConnected: boolean;
}

type PostCheck = ReadyCheck & { path: 'text' | 'media' | 'account'; message: string };

function postChecks(input: PostChecksInput): PostCheck[] {
  const length = weightedLength(input.text);
  const checks: PostCheck[] = [
    {
      code: 'text',
      path: 'text',
      ok: input.text.trim() !== '',
      label: 'Text is not empty',
      message: 'Text is empty',
    },
    {
      code: 'limit',
      path: 'text',
      ok: length <= input.limit,
      label: `${length.toLocaleString('en-US')} of ${input.limit.toLocaleString('en-US')} characters`,
      message: `${length} of ${input.limit} characters`,
    },
  ];
  const missing = input.media.filter((media) => !media.present).map((media) => media.position);
  checks.push(
    {
      code: 'media',
      path: 'media',
      ok: input.media.length <= POST_MEDIA_MAX && missing.length === 0,
      label:
        missing.length > 0
          ? missingLabel(missing)
          : `${input.media.length} of ${POST_MEDIA_MAX} images`,
      message:
        missing.length > 0
          ? missingLabel(missing)
          : `${input.media.length} of ${POST_MEDIA_MAX} media`,
    },
    {
      code: 'account',
      path: 'account',
      ok: input.accountConnected,
      label: input.accountConnected ? 'X account connected' : 'No X account connected',
      message: 'No X account connected',
    },
  );
  return checks;
}

function missingLabel(positions: number[]): string {
  if (positions.length === 1) {
    return `Media ${positions[0]} file is missing`;
  }
  return `Media ${positions.join(', ')} files are missing`;
}

/** Checks a post must pass to be promoted, in order; an empty list means ready. */
export function promoteChecks(
  input: Omit<PostChecksInput, 'accountConnected'>,
): Array<{ path: string; message: string }> {
  return postChecks({ ...input, accountConnected: true })
    .filter((row) => !row.ok)
    .map(({ path, message }) => ({ path, message }));
}

/** The "Ready to publish?" checklist shown next to a post. */
export function readyChecks(input: PostChecksInput): Ready {
  const rows = postChecks(input);
  return {
    ok: rows.every((row) => row.ok),
    checks: rows.map(({ code, ok, label }) => ({ code, ok, label })),
  };
}
