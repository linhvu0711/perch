import { z } from 'zod';

import { weightedLength } from './charCount';

export const PROMOTE_FROM = ['draft'] as const;
export const DEMOTE_FROM = ['official', 'failed'] as const;
export const SCHEDULE_FROM = ['draft', 'official'] as const;

/** Checks a post must pass to be promoted, in order; an empty list means ready. */
export function promoteChecks(input: {
  text: string;
  limit: number;
  media: Array<{ position: number; present: boolean }>;
}): Array<{ path: string; message: string }> {
  const checks: Array<{ path: string; message: string }> = [];
  if (input.text.trim() === '') {
    checks.push({ path: 'text', message: 'Text is empty' });
  }
  const length = weightedLength(input.text);
  if (length > input.limit) {
    checks.push({ path: 'text', message: `${length} of ${input.limit} characters` });
  }
  if (input.media.length > 4) {
    checks.push({ path: 'media', message: `${input.media.length} of 4 media` });
  }
  for (const media of input.media) {
    if (!media.present) {
      checks.push({ path: 'media', message: `Media ${media.position} file is missing` });
    }
  }
  return checks;
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

/** The "Ready to publish?" checklist shown next to a post. */
export function readyChecks(input: {
  text: string;
  limit: number;
  mediaCount: number;
  accountConnected: boolean;
}): Ready {
  const length = weightedLength(input.text);
  const checks: ReadyCheck[] = [
    { code: 'text', ok: input.text.trim() !== '', label: 'Text is not empty' },
    {
      code: 'limit',
      ok: length <= input.limit,
      label: `${length.toLocaleString('en-US')} of ${input.limit.toLocaleString('en-US')} characters`,
    },
    {
      code: 'media',
      ok: input.mediaCount <= 4,
      label: `${input.mediaCount} of 4 images`,
    },
    {
      code: 'account',
      ok: input.accountConnected,
      label: input.accountConnected ? 'X account connected' : 'No X account connected',
    },
  ];
  return { ok: checks.every((check) => check.ok), checks };
}
