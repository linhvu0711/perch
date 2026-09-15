import type { Command } from 'commander';

import { run } from '../cli';
import { writeConfig } from '../config';
import type { CliContext } from '../context';
import { AuthError, CliError } from '../output';

export function addAuthCommands(program: Command, ctx: CliContext): void {
  const auth = program.command('auth').description('Manage authentication');

  auth
    .command('login')
    .description('Open the web login page')
    .action(
      run(ctx, async ({ serverUrl }) => {
        const url = `${serverUrl}/`;
        if (ctx.isTTY) await ctx.openUrl(url);
        return {
          value: {
            url,
            message: 'Open this page and sign in with PERCH_TOKEN.',
          },
        };
      }),
    );

  auth
    .command('status')
    .description('Check whether the configured token is valid')
    .action(
      run(ctx, async ({ api, serverUrl, token }) => {
        if (!token) {
          throw new CliError(
            'no_token',
            'No token. Set PERCH_TOKEN or run: perch config set token <value>',
          );
        }

        try {
          const response = await api.call(api.client.api.auth.me.$get());
          return {
            value: {
              valid: true,
              user_id: response.user.id,
              server_url: serverUrl,
            },
          };
        } catch (error) {
          if (error instanceof AuthError) {
            throw new AuthError(`Token is not valid for ${serverUrl}`);
          }
          throw error;
        }
      }),
    );

  auth
    .command('logout')
    .description('Remove the locally stored token')
    .action(
      run(ctx, async ({ config }) => {
        const next = { ...config };
        if (next.token !== undefined) {
          delete next.token;
          writeConfig(ctx.configPath, next);
        }
        return { value: { ok: true } };
      }),
    );
}
