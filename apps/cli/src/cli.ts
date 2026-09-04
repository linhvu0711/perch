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
      writeErr: (value) => ctx.stderr.write(value),
    })
    .showHelpAfterError()
    .option('--json', 'print JSON')
    .option('--table', 'print a table')
    .option('--server <url>', 'override the server URL');

  addAuthCommands(program, ctx);
  addConfigCommands(program, ctx);

  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      printError(
        ctx,
        resolveMode(program.opts(), ctx.isTTY),
        error,
      );
      return error.exitCode;
    }
    if (error instanceof CommanderError) {
      if (
        error.code === 'commander.helpDisplayed' ||
        error.code === 'commander.version'
      ) {
        return 0;
      }
      return 2;
    }
    throw error;
  }
}
