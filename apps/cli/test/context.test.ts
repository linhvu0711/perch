import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { realContext } from '../src/context';

test('creates editor temp files with owner-only permissions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perch-context-'));
  const editor = path.join(dir, 'editor');
  const modeFile = path.join(dir, 'mode');
  const previousVisual = process.env.VISUAL;

  fs.writeFileSync(
    editor,
    `#!/usr/bin/env bun\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(modeFile)}, (fs.statSync(process.argv[2]!).mode & 0o777).toString(8));\n`,
    { mode: 0o700 },
  );
  process.env.VISUAL = editor;

  try {
    expect(await realContext([]).editText('private note')).toBe('private note');
    expect(fs.readFileSync(modeFile, 'utf8')).toBe('600');
  } finally {
    if (previousVisual === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = previousVisual;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
