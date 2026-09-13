import { DEFAULT_TIMEZONE, formatCost } from '@perch/core';

export function formatDayMonth(iso: string, timeZone = DEFAULT_TIMEZONE): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone,
  });
}

/** `"September 2026"` for a `YYYY-MM-DD` grid cell (calendar date, not an instant). */
export function formatMonthTitle(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `"Sep 2026"` for a `YYYY-MM` month string. */
export function formatMonthShort(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `"Sat 6 Sep"` for a `YYYY-MM-DD` calendar date. */
export function formatDayTitle(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** `"7 Sep – 13 Sep 2026"` for the Monday-first week `[from, to]` of grid cells. */
export function formatWeekTitle(from: string, to: string): string {
  const dm = (ymd: string) =>
    new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return `${dm(from)} – ${dm(to)} ${to.slice(0, 4)}`;
}

export function formatDateTime(iso: string, timeZone = DEFAULT_TIMEZONE): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  })} ${date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  })}`;
}

export function formatSchedule(iso: string, timeZone = DEFAULT_TIMEZONE): string {
  const time = new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });
  return `${formatDayMonth(iso, timeZone)}, ${time}`;
}

export function noteExcerpt(body: string): string {
  return body
    .replace(/^\s*#{1,6}[ \t].*\n+/, '')
    .replace(/[#*`>|_-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export const formatUsd = formatCost;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function wordCount(body: string): number {
  return body.trim() === '' ? 0 : body.trim().split(/\s+/).length;
}
