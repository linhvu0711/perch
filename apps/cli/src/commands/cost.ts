import { costMonthSchema, formatCost } from '@perch/core';
import type { Command } from 'commander';

import { createApi } from '../api';
import { resolveServerUrl, resolveToken } from '../config';
import type { CliContext } from '../context';
import { printResult, resolveMode, UsageError } from '../output';

interface GlobalOptions {
  json?: boolean;
  table?: boolean;
  server?: string;
  yes?: boolean;
}

function apiFor(program: Command, ctx: CliContext) {
  const options = program.opts<GlobalOptions>();
  return createApi(ctx, resolveServerUrl(ctx, options.server), resolveToken(ctx));
}

export function addCostCommands(program: Command, ctx: CliContext): void {
  program
    .command('cost')
    .description("This month's X cost split by kind")
    .option('--month <YYYY-MM>')
    .action(async (commandOptions: { month?: string }) => {
      if (
        commandOptions.month !== undefined &&
        !costMonthSchema.safeParse(commandOptions.month).success
      ) {
        throw new UsageError('usage', '--month must be YYYY-MM');
      }

      const options = program.opts<GlobalOptions>();
      const mode = resolveMode(options, ctx.isTTY);
      const api = apiFor(program, ctx);
      const result = await api.call(
        api.client.api.costs.summary.$get({
          query: commandOptions.month !== undefined ? { month: commandOptions.month } : {},
        }),
      );

      if (mode === 'json') {
        printResult(ctx, mode, result);
        return;
      }
      printResult(ctx, mode, {
        month: result.month,
        calls: result.calls,
        publish: formatCost(result.publish_usd),
        save_tweet: formatCost(result.save_tweet_usd),
        connect: formatCost(result.connect_usd),
        total: formatCost(result.total_usd),
        all_time: formatCost(result.all_time_usd),
      });
    });
}
