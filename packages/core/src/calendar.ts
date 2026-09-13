import { z } from 'zod';

import { listDateSchema, type Post, type PostStatus, postSchema } from './posts';
import { addDays } from './schedule';
import { tagFilterSchema } from './tags';

export const CALENDAR_DAY_CAP = 3;

export const calendarQuerySchema = z
  .object({ from: listDateSchema, to: listDateSchema, tag: tagFilterSchema })
  .refine((q) => q.from <= q.to, { message: 'to is before from', path: ['to'] });
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const calendarPostSchema = postSchema.extend({ missed: z.boolean() });
export type CalendarPost = z.infer<typeof calendarPostSchema>;

export const calendarDaySchema = z.object({
  date: z.string(),
  posts: z.array(calendarPostSchema),
});
export type CalendarDay = z.infer<typeof calendarDaySchema>;

export const calendarRangeSchema = z.object({
  from: z.string(),
  to: z.string(),
  days: z.array(calendarDaySchema),
});
export type CalendarRange = z.infer<typeof calendarRangeSchema>;

/** A post due in the past that cannot go out: a draft, or an official post with no X account. */
export function isMissed(
  post: { status: PostStatus; scheduled_at: string | null },
  now: Date,
  accountConnected: boolean,
): boolean {
  return (
    post.scheduled_at !== null &&
    new Date(post.scheduled_at) < now &&
    (post.status === 'draft' || (post.status === 'official' && !accountConnected))
  );
}

/** The instant a post is placed under on the calendar; published posts sit at publish time. */
export function postCalendarTime(
  post: Pick<Post, 'status' | 'scheduled_at' | 'published_at'>,
): string | null {
  return post.status === 'published' ? post.published_at : post.scheduled_at;
}

export function calendarMark(
  post: Pick<CalendarPost, 'status' | 'missed'>,
): 'MISSED' | 'FAILED' | '' {
  if (post.missed) return 'MISSED';
  if (post.status === 'failed') return 'FAILED';
  return '';
}

/** First and last day of the calendar month holding `date`. */
export function monthOf(date: string): { from: string; to: string } {
  const from = `${date.slice(0, 7)}-01`;
  return { from, to: addDays(`${date.slice(0, 7)}-01`, -1 + daysInMonth(from)) };
}

/** Monday and Sunday of the week holding `date`. */
export function weekOf(date: string): { from: string; to: string } {
  const from = addDays(date, -mondayOffset(date));
  return { from, to: addDays(from, 6) };
}

/** The 7 days (Mon–Sun) of the week holding `date`. */
export function weekGrid(date: string): string[] {
  const { from } = weekOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(from, i));
}

/**
 * Monday-first cells covering the month of `date`: 42 cells, cut to 35
 * when the last row lies entirely in the next month.
 */
export function monthGrid(date: string): string[] {
  const first = `${date.slice(0, 7)}-01`;
  const start = addDays(first, -mondayOffset(first));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const sixthRow = cells[35];
  return sixthRow !== undefined && sixthRow.slice(0, 7) === date.slice(0, 7)
    ? cells
    : cells.slice(0, 35);
}

function mondayOffset(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function daysInMonth(first: string): number {
  const y = Number(first.slice(0, 4));
  const m = Number(first.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
