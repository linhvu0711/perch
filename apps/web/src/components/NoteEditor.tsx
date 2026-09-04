import type { JSX } from 'react';

import { Markdown } from './Markdown';

export function NoteEditor({
  body,
  onChange,
}: {
  body: string;
  onChange(body: string): void;
}): JSX.Element {
  return (
    <div className="mdedit">
      <div className="pane">
        <h2>Raw</h2>
        <textarea
          aria-label="Markdown"
          spellCheck={false}
          autoFocus
          value={body}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <div className="pane">
        <h2>Preview</h2>
        <Markdown body={body} />
      </div>
    </div>
  );
}
