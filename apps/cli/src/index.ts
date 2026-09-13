#!/usr/bin/env bun

import { runCli } from './cli';
import { realContext } from './context';
import { CliError } from './output';

if (import.meta.main) {
  const argv = process.argv.slice(2);
  try {
    const code = await runCli(argv, realContext(argv, process.env));
    process.exit(code);
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`Error: ${error.message}\n`);
      process.exit(error.exitCode);
    }
    throw error;
  }
}
