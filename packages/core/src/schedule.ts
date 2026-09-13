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

function addDays(date: string, days: number): string {
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

/**
 * Parses `input` as a time in `timeZone` and returns the UTC instant.
 * Forms: ISO, `YYYY-MM-DD HH:mm`, `+Nm`/`+Nh`/`+Nd`, `today|tomorrow <time>`,
 * `(next )?<weekday> <time>`. Seconds and milliseconds are zeroed; unknown
 * input returns null.
 */
export function parseScheduleTime(input: string, timeZone: string, now: Date): Date | null {
  const value = input.trim().toLowerCase();
  let result: Date;

  let match = /^(\d{4}-\d{2}-\d{2})t(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(z|[+-]\d{2}:\d{2})?$/.exec(
    value,
  );
  if (match !== null) {
    const date = match[1]!;
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    if (!isCalendarDate(y, m, d)) return null;
    if (match[4] !== undefined) {
      const parsed = new Date(match[0].toUpperCase());
      if (Number.isNaN(parsed.getTime())) return null;
      result = parsed;
    } else {
      result = zonedToUtc(date, `${match[2]!}:${match[3]!}`, timeZone);
    }
  } else if ((match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(value)) !== null) {
    const [y, m, d] = match[1]!.split('-').map(Number) as [number, number, number];
    if (!isCalendarDate(y, m, d)) return null;
    result = zonedToUtc(match[1]!, `${match[2]!}:${match[3]!}`, timeZone);
  } else if ((match = /^\+(\d+)([mhd])$/.exec(value)) !== null) {
    const amount = Number(match[1]);
    if (match[2] === 'm') {
      result = new Date(now.getTime() + amount * 60_000);
    } else if (match[2] === 'h') {
      result = new Date(now.getTime() + amount * 3_600_000);
    } else {
      const parts = zonedParts(now, timeZone);
      result = zonedToUtc(addDays(parts.date, amount), parts.time, timeZone);
    }
  } else if ((match = /^(today|tomorrow) (.+)$/.exec(value)) !== null) {
    const time = parseTime(match[2]!);
    if (time === null) return null;
    const parts = zonedParts(now, timeZone);
    result = zonedToUtc(
      match[1] === 'tomorrow' ? addDays(parts.date, 1) : parts.date,
      time,
      timeZone,
    );
  } else if (
    (match = /^(?:next )?(sun|mon|tue|wed|thu|fri|sat)[a-z]* (.+)$/.exec(value)) !== null
  ) {
    const time = parseTime(match[2]!);
    if (time === null) return null;
    const parts = zonedParts(now, timeZone);
    const target = WEEKDAY_NUMBERS[match[1]!] ?? 0;
    let delta = (target - parts.weekday + 7) % 7;
    if (delta === 0) delta = 7;
    result = zonedToUtc(addDays(parts.date, delta), time, timeZone);
  } else {
    return null;
  }

  result.setSeconds(0, 0);
  return result;
}
