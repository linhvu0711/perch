import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import type { CliContext } from './context';
import { CliError } from './output';

export interface LocalConfig {
  'server-url'?: string;
  token?: string;
}

const localConfigSchema = z.object({
  'server-url': z.string().optional(),
  token: z.string().optional(),
});

export const LOCAL_CONFIG_KEYS = ['server-url', 'token'] as const;
export const REMOTE_CONFIG_KEYS = ['timezone', 'char-limit'] as const;

export function readConfig(configPath: string): LocalConfig {
  if (!fs.existsSync(configPath)) return {};

  try {
    const value: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return localConfigSchema.parse(value);
  } catch {
    throw new CliError('config_invalid', `Invalid config file: ${configPath}`);
  }
}

export function writeConfig(configPath: string, config: LocalConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, configPath);
}

export function resolveServerUrl(
  ctx: CliContext,
  flagValue?: string,
): string {
  const value =
    flagValue ??
    ctx.env.PERCH_SERVER_URL ??
    readConfig(ctx.configPath)['server-url'] ??
    'http://localhost:3000';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function resolveToken(ctx: CliContext): string | undefined {
  return ctx.env.PERCH_TOKEN ?? readConfig(ctx.configPath).token;
}
