import fs from 'node:fs';
import path from 'node:path';

import type { CliContext } from './context';
import { CliError } from './output';

export interface LocalConfig {
  'server-url'?: string;
  token?: string;
}

export const LOCAL_CONFIG_KEYS = ['server-url', 'token'] as const;
export const REMOTE_CONFIG_KEYS = ['timezone', 'char-limit'] as const;

export function readConfig(configPath: string): LocalConfig {
  if (!fs.existsSync(configPath)) return {};

  try {
    const value: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('config must be an object');
    }
    return value as LocalConfig;
  } catch {
    throw new CliError('config_invalid', `Invalid config file: ${configPath}`);
  }
}

export function writeConfig(configPath: string, config: LocalConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.chmodSync(configPath, 0o600);
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
