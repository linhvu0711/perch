import type { Command } from 'commander';

import { createApi } from '../api';
import { readConfig, resolveServerUrl, resolveToken, writeConfig } from '../config';
import type { CliContext } from '../context';
import { CliError, printResult, resolveMode } from '../output';

interface GlobalOptions {
  json?: boolean;
  table?: boolean;
  server?: string;
}

export function addAuthCommands(program: Command, ctx: CliContext): void {
  const auth = program.command('auth').description('Manage authentication');

  auth
    .command('login')
    .description('Open the web login page')
    .action(async () => {
      const options = program.opts<GlobalOptions>();
      const url = `${resolveServerUrl(ctx, options.server)}/`;
      printResult(ctx, resolveMode(options, ctx.isTTY), {
        url,
        message: 'Open this page and sign in with PERCH_TOKEN.',
      });
      if (ctx.isTTY) await ctx.openUrl(url);
    });

  auth
    .command('status')
    .description('Check whether the configured token is valid')
    .action(async () => {
      const options = program.opts<GlobalOptions>();
      const mode = resolveMode(options, ctx.isTTY);
      const serverUrl = resolveServerUrl(ctx, options.server);
      const token = resolveToken(ctx);
      if (!token) {
        throw new CliError(
          'no_token',
          'No token. Set PERCH_TOKEN or run: perch config set token <value>',
        );
      }

      const api = createApi(ctx, serverUrl, token);
      try {
        const response = await api.call(api.client.api.auth.me.$get());
        printResult(ctx, mode, {
          valid: true,
          user_id: response.user.id,
          server_url: serverUrl,
        });
      } catch (error) {
        if (error instanceof CliError && error.code === 'unauthorized') {
          throw new CliError(
            'unauthorized',
            `Token is not valid for ${serverUrl}`,
            3,
          );
        }
        throw error;
      }
    });

  auth
    .command('logout')
    .description('Remove the locally stored token')
    .action(() => {
      const options = program.opts<GlobalOptions>();
      const config = readConfig(ctx.configPath);
      if (config.token !== undefined) {
        delete config.token;
        writeConfig(ctx.configPath, config);
      }
      printResult(ctx, resolveMode(options, ctx.isTTY), { ok: true });
    });
}
