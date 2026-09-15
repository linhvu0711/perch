import type { ItemTagsResponse } from '@perch/core';
import { Command, CommanderError } from 'commander';
import packageJson from '../package.json' with { type: 'json' };

import { createApi } from './api';
import { addAccountCommands } from './commands/account';
import { addAuthCommands } from './commands/auth';
import { addCalendarCommands } from './commands/calendar';
import { addConfigCommands } from './commands/config';
import { addCostCommands } from './commands/cost';
import { addOpenCommands } from './commands/open';
import { addPostCommands } from './commands/post';
import { addResourceCommands } from './commands/resource';
import { addStatusCommands } from './commands/status';
import { addTagCommands } from './commands/tag';
import { type LocalConfig, resolveServerUrl, resolveToken } from './config';
import type { CliContext } from './context';
import {
  BatchFailure,
  CliError,
  type OutputMode,
  printError,
  printResult,
  resolveMode,
  UsageError,
} from './output';

export interface GlobalOptions {
  json?: boolean;
  table?: boolean;
  server?: string;
  yes?: boolean;
}

export function positiveId(value: string, plural = false): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new UsageError(
      'bad_args',
      plural ? 'ids must be positive integers' : 'id must be a positive integer',
    );
  }
  return Number(value);
}

/** Merges sequential tag add/remove results per id: a later result wins only when the earlier one succeeded. */
export function mergeItemTagResults(
  ...batches: ItemTagsResponse['results'][]
): ItemTagsResponse['results'] {
  const merged = new Map<number, ItemTagsResponse['results'][number]>();
  for (const batch of batches) {
    for (const result of batch) {
      const existing = merged.get(result.id);
      if (existing === undefined || existing.ok) merged.set(result.id, result);
    }
  }
  return [...merged.values()];
}

export interface Tools {
  ctx: CliContext;
  mode: OutputMode;
  globals: GlobalOptions;
  config: LocalConfig;
  serverUrl: string;
  token: string | undefined;
  api: ReturnType<typeof createApi>;
  confirmOrRefuse(question: string, refusal: string): Promise<boolean>;
}

export type CommandResult =
  | undefined
  | { value: unknown; table?: unknown }
  | { batch: Array<{ ok: boolean }>; table?: unknown };

export function run<A extends unknown[]>(
  ctx: CliContext,
  fn: (tools: Tools, ...args: A) => Promise<CommandResult>,
): (...raw: unknown[]) => Promise<void> {
  return async (...raw: unknown[]) => {
    const command = raw[raw.length - 1] as Command;
    const globals = command.optsWithGlobals<GlobalOptions>();
    const mode = resolveMode(globals, ctx.isTTY);
    const config = ctx.readConfig();
    const serverUrl = resolveServerUrl(ctx, config, globals.server);
    const token = resolveToken(ctx, config);
    const api = createApi(ctx, serverUrl, token);
    const tools: Tools = {
      ctx,
      mode,
      globals,
      config,
      serverUrl,
      token,
      api,
      async confirmOrRefuse(question: string, refusal: string): Promise<boolean> {
        if (globals.yes) return true;
        if (!ctx.isTTY || !ctx.stdinIsTTY) throw new CliError('confirm_required', refusal);
        const ok = await ctx.confirm(question);
        if (!ok) ctx.stderr.write('Cancelled\n');
        return ok;
      },
    };
    const result = await fn(tools, ...(raw.slice(0, -1) as A));
    if (result === undefined) return;
    const value = 'batch' in result ? result.batch : result.value;
    printResult(ctx, mode, mode === 'json' ? value : (result.table ?? value));
    if ('batch' in result) {
      const failed = result.batch.filter((item) => !item.ok).length;
      if (failed > 0) throw new BatchFailure(failed, result.batch.length);
    }
  };
}

export async function runCli(argv: string[], ctx: CliContext): Promise<number> {
  const program = new Command()
    .name('perch')
    .version(packageJson.version)
    .exitOverride()
    .configureOutput({
      writeOut: (value) => ctx.stdout.write(value),
      writeErr: (value) => {
        if (resolveMode(program.opts(), ctx.isTTY) === 'table') {
          ctx.stderr.write(value);
        }
      },
    })
    .showHelpAfterError()
    .option('--json', 'print JSON')
    .option('--table', 'print a table')
    .option('--server <url>', 'override the server URL')
    .option('--yes', 'skip confirmation prompts');

  addAccountCommands(program, ctx);
  addAuthCommands(program, ctx);
  addCalendarCommands(program, ctx);
  addConfigCommands(program, ctx);
  addCostCommands(program, ctx);
  addPostCommands(program, ctx);
  addResourceCommands(program, ctx);
  addOpenCommands(program, ctx);
  addStatusCommands(program, ctx);
  addTagCommands(program, ctx);

  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (error) {
    const mode = resolveMode(program.opts(), ctx.isTTY);
    if (error instanceof BatchFailure) return error.exitCode;
    if (error instanceof CliError) {
      printError(ctx, mode, error);
      return error.exitCode;
    }
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
        return 0;
      }
      const usage = new UsageError('usage', error.message);
      if (mode === 'json') {
        printError(ctx, mode, usage);
      }
      return usage.exitCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    printError(ctx, mode, new CliError('internal', message));
    return 1;
  }
}
