export function formatDayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} ${date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function noteExcerpt(body: string): string {
  return body
    .replace(/^\s*#{1,6}[ \t].*\n+/, '')
    .replace(/[#*`>|_-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function wordCount(body: string): number {
  return body.trim() === '' ? 0 : body.trim().split(/\s+/).length;
}
