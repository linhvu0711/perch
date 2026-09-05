export interface CursorKey {
  createdAt: number;
  id: number;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify({ c: key.createdAt, i: key.id })).toString('base64url');
}

export function decodeCursor(cursor: string): CursorKey | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;

  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

    const { c, i } = value as Record<string, unknown>;
    if (!Number.isInteger(c) || !Number.isInteger(i) || (i as number) <= 0) return null;

    return { createdAt: c as number, id: i as number };
  } catch {
    return null;
  }
}
