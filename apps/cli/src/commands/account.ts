import type { Command } from 'commander';

import { createApi } from '../api';
import { resolveServerUrl, resolveToken } from '../config';
import type { CliContext } from '../context';
import { CliError, printResult, resolveMode } from '../output';

interface GlobalOptions {
  json?: boolean;
  table?: boolean;
  server?: string;
  yes?: boolean;
}

export function addAccountCommands(program: Command, ctx: CliContext): void {
  const account = program.command('account').description('Manage the connected X account');

  account
    .command('show')
    .description('Show the connected X account')
    .action(async () => {
      const options = program.opts<GlobalOptions>();
      const mode = resolveMode(options, ctx.isTTY);
      const serverUrl = resolveServerUrl(ctx, options.server);
      const api = createApi(ctx, serverUrl, resolveToken(ctx));
      const status = await api.call(api.client.api.account.$get());

      printResult(
        ctx,
        mode,
        status.account
          ? {
              connected: true,
              username: status.account.username,
              x_user_id: status.account.x_user_id,
              subscription_type: status.account.subscription_type,
              char_limit: status.char_limit,
              connected_at: status.account.connected_at,
              reconnect_required: status.account.reconnect_required,
            }
          : { connected: false, char_limit: status.char_limit },
      );
    });

  account
    .command('disconnect')
    .description('Revoke the X token at X and disconnect')
    .action(async () => {
      const options = program.opts<GlobalOptions>();
      const mode = resolveMode(options, ctx.isTTY);
      const serverUrl = resolveServerUrl(ctx, options.server);
      const api = createApi(ctx, serverUrl, resolveToken(ctx));

      const status = await api.call(api.client.api.account.$get());
      if (!status.account) {
        throw new CliError('not_found', 'No X account connected');
      }

      if (!options.yes) {
        if (!ctx.isTTY || !ctx.stdinIsTTY) {
          throw new CliError('confirm_required', 'Refusing to disconnect without --yes');
        }
        const confirmed = await ctx.confirm(
          `Disconnect @${status.account.username}? This revokes the token at X.`,
        );
        if (!confirmed) {
          ctx.stderr.write('Cancelled\n');
          return;
        }
      }

      await api.call(api.client.api.account.disconnect.$post());
      printResult(ctx, mode, { disconnected: true });
    });
}
