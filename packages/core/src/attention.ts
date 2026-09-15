import type { PostStatus } from './posts';

export const ATTENTION_WINDOW_DAYS = 3;
export const ATTENTION_WINDOW_MS = ATTENTION_WINDOW_DAYS * 86_400_000;

/** A Draft whose schedule time falls inside the closed window [now, now + 3 days]. */
export function dueSoonDraft(
  post: { status: PostStatus; scheduled_at: string | null },
  now: Date,
): boolean {
  if (post.status !== 'draft' || post.scheduled_at === null) return false;
  const at = new Date(post.scheduled_at).getTime();
  return now.getTime() <= at && at <= now.getTime() + ATTENTION_WINDOW_MS;
}

/** The Issues set: a Missed or Failed Post. A Draft due soon is not an Issue. */
export function needsAttention(post: { status: PostStatus; missed: boolean }): boolean {
  return post.missed || post.status === 'failed';
}

/** Why a Post needs attention, in plain words; `null` when it does not. */
export function attentionReason(
  post: {
    status: PostStatus;
    scheduled_at: string | null;
    missed: boolean;
    last_error: string | null;
  },
  now: Date,
): string | null {
  if (post.status === 'failed') {
    return post.last_error !== null ? `publish failed: ${post.last_error}` : 'publish failed';
  }
  if (post.missed) {
    return post.status === 'draft' ? 'time passed, still a draft' : 'time passed, no X account';
  }
  if (dueSoonDraft(post, now)) return 'still a draft';
  return null;
}

/** How dismiss takes a Post out of Issues: demote a Failed post, unschedule the rest. */
export function dismissAction(status: PostStatus): 'demote' | 'unschedule' {
  return status === 'failed' ? 'demote' : 'unschedule';
}
