#!/usr/bin/env bun

import { runCli } from './cli';
import { realContext } from './context';

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const code = await runCli(argv, realContext(argv));
  process.exit(code);
}
