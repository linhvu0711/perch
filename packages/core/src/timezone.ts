export const DEFAULT_TIMEZONE = 'UTC';

export function isValidTimeZone(tz: string): boolean {
  if (tz.length === 0) return false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidDate(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function zonedDayStart(ymd: string, timeZone: string): Date {
  return dayBoundsUtc(ymd, timeZone).start;
}

export function zonedDayEnd(ymd: string, timeZone: string): Date {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return dayBoundsUtc(
    `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`,
    timeZone,
  ).start;
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - instant.getTime();
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Local `{ date, time, weekday }` of `instant` in `timeZone`. */
export function zonedParts(
  instant: Date,
  timeZone: string,
): { date: string; time: string; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    weekday: WEEKDAYS[get('weekday') ?? ''] ?? 0,
  };
}

/** UTC instant for a wall `date` (`YYYY-MM-DD`) and `time` (`HH:mm`) in `timeZone`. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, min] = time.split(':').map(Number) as [number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, h, min));
  let instant = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  instant = new Date(guess.getTime() - zoneOffsetMs(instant, timeZone));
  return instant;
}

function localDay(instant: Date, timeZone: string): string {
  return zonedParts(instant, timeZone).date;
}

/** UTC bounds [start, end] of a `YYYY-MM-DD` calendar day in `timeZone`, inclusive. */
export function dayBoundsUtc(day: string, timeZone: string): { start: Date; end: Date } {
  const dayStart = (y: number, m: number, d: number): Date => {
    const guess = new Date(Date.UTC(y, m - 1, d));
    let start = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
    start = new Date(guess.getTime() - zoneOffsetMs(start, timeZone));
    // Zones whose clocks jump at local midnight have no 00:00; walk forward
    // to the first instant that actually falls on the requested day.
    const wanted = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let guard = 0;
    while (localDay(start, timeZone) < wanted && guard++ < 1500) {
      start = new Date(start.getTime() + 60_000);
    }
    return start;
  };

  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const start = dayStart(y, m, d);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = new Date(
    dayStart(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()).getTime() - 1,
  );
  return { start, end };
}
