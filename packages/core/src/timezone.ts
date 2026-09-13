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
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)!.value);
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

/** UTC bounds [start, end] of a `YYYY-MM-DD` calendar day in `timeZone`, inclusive. */
export function dayBoundsUtc(
  day: string,
  timeZone: string,
): { start: Date; end: Date } {
  const dayStart = (y: number, m: number, d: number): Date => {
    const guess = new Date(Date.UTC(y, m - 1, d));
    let start = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
    start = new Date(guess.getTime() - zoneOffsetMs(start, timeZone));
    return start;
  };

  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const start = dayStart(y, m, d);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = new Date(dayStart(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()).getTime() - 1);
  return { start, end };
}
