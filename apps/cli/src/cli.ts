import packageJson from '../package.json' with { type: 'json' };
import { Command, CommanderError } from 'commander';

import { addAuthCommands } from './commands/auth';
import { addConfigCommands } from './commands/config';
import type { CliContext } from './context';
import { CliError, printError, resolveMode } from './output';

export async function runCli(
  argv: string[],
  ctx: CliContext,
): Promise<number> {
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

  addAuthCommands(program, ctx);
  addConfigCommands(program, ctx);

  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (error) {
    const mode = resolveMode(program.opts(), ctx.isTTY);
    if (error instanceof CliError && error.code === 'batch_failed') return 1;
    if (error instanceof CliError) {
      printError(ctx, mode, error);
      return error.exitCode;
    }
    if (error instanceof CommanderError) {
      if (
        error.code === 'commander.helpDisplayed' ||
        error.code === 'commander.version'
      ) {
        return 0;
      }
      if (mode === 'json') {
        printError(ctx, mode, new CliError('usage', error.message, 2));
      }
      return 2;
    }
    const message = error instanceof Error ? error.message : String(error);
    printError(ctx, mode, new CliError('internal', message));
    return 1;
  }
}
