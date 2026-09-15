import { CHAR_LIMIT_MAX, charLimitOverrideSchema, type Settings } from '@perch/core';
import type { Command } from 'commander';

import { run } from '../cli';
import { LOCAL_CONFIG_KEYS, REMOTE_CONFIG_KEYS, writeConfig } from '../config';
import type { CliContext } from '../context';
import { CliError, UsageError } from '../output';

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
    .action(
      run(ctx, async ({ api, config }, key: string) => {
        assertKey(key);
        let value: string | number | null | undefined;

        if ((LOCAL_CONFIG_KEYS as readonly string[]).includes(key)) {
          value = config[key as keyof typeof config];
        } else {
          const settings = await api.call(api.client.api.settings.$get());
          value = key === 'timezone' ? settings.timezone : settings.char_limit_override;
        }

        return {
          value: { key, value: value ?? null },
        };
      }),
    );

  config
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(
      run(ctx, async ({ api, config }, key: string, value: string) => {
        assertKey(key);
        let resultValue: string | number | null = value;

        if ((LOCAL_CONFIG_KEYS as readonly string[]).includes(key)) {
          const local = { ...config };
          local[key as 'server-url' | 'token'] = value;
          writeConfig(ctx.configPath, local);
        } else {
          let settings: Settings;
          if (key === 'timezone') {
            settings = await api.call(
              api.client.api.settings.$patch({
                json: { timezone: value },
              }),
            );
            resultValue = settings.timezone;
          } else {
            const parsedLimit = charLimitOverrideSchema.safeParse(
              value === 'none' ? null : Number(value),
            );
            if (!parsedLimit.success) {
              throw new UsageError(
                'usage',
                `char-limit must be a whole number from 1 to ${CHAR_LIMIT_MAX}, or "none"`,
              );
            }
            const charLimit = parsedLimit.data;
            settings = await api.call(
              api.client.api.settings.$patch({
                json: { char_limit_override: charLimit },
              }),
            );
            resultValue = settings.char_limit_override;
          }
        }

        return {
          value: { key, value: resultValue },
        };
      }),
    );
}
