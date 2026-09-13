import { DEFAULT_TIMEZONE, formatCost } from '@perch/core';

export function formatDayMonth(iso: string, timeZone = DEFAULT_TIMEZONE): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone,
  });
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
