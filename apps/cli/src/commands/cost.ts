import {
  COST_MONTHS_LIMIT_DEFAULT,
  type CostMonthRow,
  costMonthSchema,
  formatCost,
} from '@perch/core';
import type { Command } from 'commander';

import { createApi } from '../api';
import { resolveServerUrl, resolveToken } from '../config';
import type { CliContext } from '../context';
import { CliError, formatTable, printResult, resolveMode } from '../output';

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

function costRow(row: CostMonthRow): Record<string, unknown> {
  return {
    month: row.month,
    calls: row.calls,
    publish: formatCost(row.publish_usd),
    save_tweet: formatCost(row.save_tweet_usd),
    connect: formatCost(row.connect_usd),
    total: formatCost(row.total_usd),
  };
}

export function addCostCommands(program: Command, ctx: CliContext): void {
  program
    .command('cost')
    .description('X API cost by month')
    .option('--month <month>', 'show one month (YYYY-MM)')
    .option('--months <count>', 'how many months to list', String(COST_MONTHS_LIMIT_DEFAULT))
    .action(async (commandOptions: { month?: string; months?: string }) => {
      const options = program.opts<GlobalOptions>();
      const mode = resolveMode(options, ctx.isTTY);
      const api = apiFor(program, ctx);

      if (commandOptions.month !== undefined) {
        if (!costMonthSchema.safeParse(commandOptions.month).success) {
          throw new CliError('usage', '--month must be YYYY-MM', 2);
        }
        const summary = await api.call(
          api.client.api.costs.$get({ query: { month: commandOptions.month } }),
        );
        if (mode === 'json') {
          printResult(ctx, mode, summary);
          return;
        }
        ctx.stdout.write(
          `${formatTable([costRow(summary)])}\nall time ${formatCost(summary.all_time_usd)}\n`,
        );
        return;
      }

      const months = Number(commandOptions.months);
      if (!Number.isInteger(months) || months <= 0) {
        throw new CliError('usage', '--months must be a positive number', 2);
      }
      const [history, summary] = await Promise.all([
        api.call(api.client.api.costs.months.$get({ query: { limit: String(months) } })),
        api.call(api.client.api.costs.$get({ query: {} })),
      ]);
      if (mode === 'json') {
        printResult(ctx, mode, history);
        return;
      }
      const rows = history.items.map(costRow);
      const table = rows.length === 0 ? '' : `${formatTable(rows)}\n`;
      ctx.stdout.write(`${table}all time ${formatCost(summary.all_time_usd)}\n`);
    });
}
