import type { CliContext } from './context';

export class CliError extends Error {
  constructor(
    public code: string,
    message: string,
    public exitCode = 1,
    public errors?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

export class BatchFailure extends CliError {
  constructor(failed: number, total: number) {
    super('batch_failed', `${failed} of ${total} items failed`, 1);
  }
}

export type OutputMode = 'json' | 'table';

export function resolveMode(
  opts: { json?: boolean; table?: boolean },
  isTTY: boolean,
): OutputMode {
  if (opts.json) return 'json';
  if (opts.table) return 'table';
  return isTTY ? 'table' : 'json';
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function formatTable(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    if (value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const rows = value as Array<Record<string, unknown>>;
      const keys: string[] = [];
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          if (!keys.includes(key)) keys.push(key);
        }
      }
      const values = rows.map((row) => keys.map((key) => formatValue(row[key])));
      const widths = keys.map((key, index) =>
        Math.max(key.length, ...values.map((row) => row[index]?.length ?? 0)),
      );
      return [keys, ...values]
        .map((row) =>
          row
            .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
            .join('  ')
            .trimEnd(),
        )
        .join('\n');
    }
    return value.map(formatValue).join('\n');
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    const maxKeyLength = Math.max(0, ...entries.map(([key]) => key.length));
    return entries
      .map(
        ([key, entryValue]) =>
          `${key.padEnd(maxKeyLength + 2)}${formatValue(entryValue)}`,
      )
      .join('\n');
  }

  return formatValue(value);
}

export function printResult(
  ctx: CliContext,
  mode: OutputMode,
  value: unknown,
): void {
  ctx.stdout.write(
    mode === 'json'
      ? `${JSON.stringify(value, null, 2)}\n`
      : `${formatTable(value)}\n`,
  );
}

export function printError(
  ctx: CliContext,
  mode: OutputMode,
  error: CliError,
): void {
  if (mode === 'json') {
    const body = error.errors
      ? { code: error.code, message: error.message, errors: error.errors }
      : { code: error.code, message: error.message };
    ctx.stderr.write(`${JSON.stringify(body)}\n`);
    return;
  }

  const details = error.errors?.map(
    ({ path, message }) => `  ${path}: ${message}`,
  ) ?? [];
  ctx.stderr.write([`Error: ${error.message}`, ...details].join('\n') + '\n');
}
