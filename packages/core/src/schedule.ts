import { zonedParts, zonedToUtc } from './timezone';

/** Whether `year`-`month`-`day` is a real calendar date. */
export function isCalendarDate(year: number, month: number, day: number): boolean {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

const WEEKDAY_NUMBERS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** `H:MM`, `Ham`, or `H:MMam` → `HH:mm`; `12am` is `00:00`, `12pm` is `12:00`. */
function parseTime(input: string): string | null {
  let match = /^(\d{1,2}):(\d{2})$/.exec(input);
  if (match !== null) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return `${String(hours).padStart(2, '0')}:${match[2]}`;
  }
  match = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(input);
  if (match === null) return null;
  let hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  hours = (hours % 12) + (match[3] === 'pm' ? 12 : 0);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const ISO_RE = /^(\d{4}-\d{2}-\d{2})t(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(z|[+-]\d{2}:\d{2})?$/;
const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/;
const RELATIVE_RE = /^\+(\d+)([mhd])$/;
const TODAY_RE = /^(today|tomorrow) (.+)$/;
const WEEKDAY_RE =
  /^(?:next )?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?) (.+)$/;

/**
 * Parses `input` as a time in `timeZone` and returns the UTC instant.
 * Forms: ISO, `YYYY-MM-DD HH:mm`, `+Nm`/`+Nh`/`+Nd`, `today|tomorrow <time>`,
 * `(next )?<weekday> <time>`. Seconds and milliseconds are zeroed; unknown
 * input returns null.
 */
export function parseScheduleTime(input: string, timeZone: string, now: Date): Date | null {
  const value = input.trim().toLowerCase();
  let result: Date;

  const isoMatch = ISO_RE.exec(value);
  const dateTimeMatch = isoMatch === null ? DATE_TIME_RE.exec(value) : null;
  const relMatch = isoMatch === null && dateTimeMatch === null ? RELATIVE_RE.exec(value) : null;
  if (isoMatch !== null) {
    const match = isoMatch;
    const date = match[1] as string;
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    if (!isCalendarDate(y, m, d)) return null;
    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    if (hours > 23 || minutes > 59) return null;
    if (match[4] !== undefined) {
      const parsed = new Date(match[0].toUpperCase());
      if (Number.isNaN(parsed.getTime())) return null;
      result = parsed;
    } else {
      result = zonedToUtc(date, `${match[2]}:${match[3]}`, timeZone);
    }
  } else if (dateTimeMatch !== null) {
    const match = dateTimeMatch;
    const [y, m, d] = (match[1] as string).split('-').map(Number) as [number, number, number];
    if (!isCalendarDate(y, m, d)) return null;
    if (Number(match[2]) > 23 || Number(match[3]) > 59) return null;
    result = zonedToUtc(match[1] as string, `${match[2]}:${match[3]}`, timeZone);
  } else if (relMatch !== null) {
    const match = relMatch;
    const amount = Number(match[1]);
    if (match[2] === 'm') {
      result = new Date(now.getTime() + amount * 60_000);
    } else if (match[2] === 'h') {
      result = new Date(now.getTime() + amount * 3_600_000);
    } else {
      const parts = zonedParts(now, timeZone);
      result = zonedToUtc(addDays(parts.date, amount), parts.time, timeZone);
    }
  } else {
    const word = TODAY_RE.exec(value) ?? WEEKDAY_RE.exec(value);
    if (word === null) return null;
    const time = parseTime(word[2] as string);
    if (time === null) return null;
    const parts = zonedParts(now, timeZone);
    if (word[1] === 'today' || word[1] === 'tomorrow') {
      result = zonedToUtc(
        word[1] === 'tomorrow' ? addDays(parts.date, 1) : parts.date,
        time,
        timeZone,
      );
    } else {
      const target = WEEKDAY_NUMBERS[(word[1] as string).slice(0, 3)] ?? 0;
      let delta = (target - parts.weekday + 7) % 7;
      if (delta === 0) delta = 7;
      result = zonedToUtc(addDays(parts.date, delta), time, timeZone);
    }
  }

  result.setSeconds(0, 0);
  return result;
}
