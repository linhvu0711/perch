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
