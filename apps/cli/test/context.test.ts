import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { realContext } from '../src/context';
import { CliError } from '../src/output';

test('creates editor temp files with owner-only permissions', async () => {
  // Given: a temp dir and an editor script that records the file mode
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perch-context-'));
  const editor = path.join(dir, 'editor');
  const modeFile = path.join(dir, 'mode');
  fs.writeFileSync(
    editor,
    `#!/usr/bin/env bun\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(modeFile)}, (fs.statSync(process.argv[2]!).mode & 0o777).toString(8));\n`,
    { mode: 0o700 },
  );

  try {
    // When
    const result = await realContext([], { VISUAL: editor }).editText('private note');
    // Then
    expect(result).toBe('private note');
    expect(fs.readFileSync(modeFile, 'utf8')).toBe('600');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('throws no_editor when no editor is set', async () => {
  // Given: an env with no editor
  // When
  const edit = realContext([], {}).editText('x');
  // Then
  await expect(edit).rejects.toThrow(CliError);
  await expect(edit).rejects.toMatchObject({
    code: 'no_editor',
    message: 'Set $EDITOR (or $VISUAL) to use -e',
  });
});
