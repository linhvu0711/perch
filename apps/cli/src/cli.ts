import { Command, CommanderError } from 'commander';
import packageJson from '../package.json' with { type: 'json' };

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
import type { CliContext } from './context';
import { BatchFailure, CliError, printError, resolveMode, UsageError } from './output';

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
