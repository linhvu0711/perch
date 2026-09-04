import type { Settings } from '@perch/core';
import type { Command } from 'commander';

import { createApi } from '../api';
import {
  LOCAL_CONFIG_KEYS,
  readConfig,
  REMOTE_CONFIG_KEYS,
  resolveServerUrl,
  resolveToken,
  writeConfig,
} from '../config';
import type { CliContext } from '../context';
import { CliError, printResult, resolveMode } from '../output';

interface GlobalOptions {
  json?: boolean;
  table?: boolean;
  server?: string;
}

function assertKey(key: string): void {
  if (
    !(LOCAL_CONFIG_KEYS as readonly string[]).includes(key) &&
    !(REMOTE_CONFIG_KEYS as readonly string[]).includes(key)
  ) {
    throw new CliError('bad_key', `Unknown key: ${key}`);
  }
}

export function addConfigCommands(program: Command, ctx: CliContext): void {
  const config = program.command('config').description('Manage configuration');

  config
    .command('get <key>')
    .description('Read a configuration value')
    .action(async (key: string) => {
      assertKey(key);
      const options = program.opts<GlobalOptions>();
      let value: string | number | null | undefined;

      if ((LOCAL_CONFIG_KEYS as readonly string[]).includes(key)) {
        value = readConfig(ctx.configPath)[key as keyof ReturnType<typeof readConfig>];
      } else {
        const serverUrl = resolveServerUrl(ctx, options.server);
        const api = createApi(ctx, serverUrl, resolveToken(ctx));
        const settings = await api.call(api.client.api.settings.$get());
        value =
          key === 'timezone'
            ? settings.timezone
            : settings.char_limit_override;
      }

      printResult(ctx, resolveMode(options, ctx.isTTY), {
        key,
        value: value ?? null,
      });
    });

  config
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(async (key: string, value: string) => {
      assertKey(key);
      const options = program.opts<GlobalOptions>();
      let resultValue: string | number | null = value;

      if ((LOCAL_CONFIG_KEYS as readonly string[]).includes(key)) {
        const local = readConfig(ctx.configPath);
        local[key as 'server-url' | 'token'] = value;
        writeConfig(ctx.configPath, local);
      } else {
        const serverUrl = resolveServerUrl(ctx, options.server);
        const api = createApi(ctx, serverUrl, resolveToken(ctx));
        let settings: Settings;
        if (key === 'timezone') {
          settings = await api.call(
            api.client.api.settings.$patch({
              json: { timezone: value },
            }),
          );
          resultValue = settings.timezone;
        } else {
          if (value !== 'none' && !/^\d+$/.test(value)) {
            throw new CliError(
              'bad_value',
              'char-limit must be a whole number or "none"',
            );
          }
          const charLimit = value === 'none' ? null : Number(value);
          settings = await api.call(
            api.client.api.settings.$patch({
              json: { char_limit_override: charLimit },
            }),
          );
          resultValue = settings.char_limit_override;
        }
      }

      printResult(ctx, resolveMode(options, ctx.isTTY), {
        key,
        value: resultValue,
      });
    });
}
