import { Plus, Search, Tag, X } from 'lucide-react';
import { type JSX, useEffect, useRef, useState } from 'react';

import { useTags } from '@/lib/queries';

export function TagField(props: {
  tags: string[];
  readOnly: boolean;
  disabled?: boolean;
  onAdd(name: string): void;
  onRemove(name: string): void;
}): JSX.Element {
  return (
    <div className="field">
      <div className="flabel">Tags</div>
      <div className="tagbox">
        {props.tags.map((name) => (
          <span key={name} className="tag">
            {name}
            {!props.readOnly && (
              <button
                type="button"
                className="rm"
                aria-label={`Remove ${name}`}
                title="Remove"
                disabled={props.disabled}
                onClick={() => props.onRemove(name)}
              >
                <X size={11} strokeWidth={1.75} />
              </button>
            )}
          </span>
        ))}
        {!props.readOnly && (
          <TagPicker current={props.tags} disabled={props.disabled} onPick={props.onAdd} />
        )}
      </div>
    </div>
  );
}

function TagPicker(props: {
  current: string[];
  disabled?: boolean;
  onPick(name: string): void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const tags = useTags();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        setOpen(false);
      }
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  const taken = new Set(props.current.map((name) => name.toLowerCase()));
  const trimmed = query.trim();
  const options = (tags.data?.items ?? []).filter(
    (tag) =>
      !taken.has(tag.name.toLowerCase()) && tag.name.toLowerCase().includes(query.toLowerCase()),
  );
  const canCreate = trimmed !== '' && !taken.has(trimmed.toLowerCase());

  const pick = (name: string) => {
    props.onPick(name);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="add"
        aria-haspopup="menu"
        disabled={props.disabled}
        onClick={() => {
          setQuery('');
          setOpen((current) => !current);
        }}
      >
        + add
      </button>
      {open && (
        <div className="menu tagpick" role="menu">
          <div className="search">
            <Search size={16} strokeWidth={1.75} />
            <input
              aria-label="Find or create a tag"
              placeholder="Find or create a tag"
              // biome-ignore lint/a11y/noAutofocus: picker search autofocus like other menus
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && trimmed !== '') {
                  event.preventDefault();
                  pick(trimmed);
                }
              }}
            />
          </div>
          {options.map((tag) => (
            <button type="button" role="menuitem" key={tag.id} onClick={() => pick(tag.name)}>
              <Tag size={14} strokeWidth={1.75} />
              {tag.name}
            </button>
          ))}
          {canCreate && (
            <button type="button" className="create" role="menuitem" onClick={() => pick(trimmed)}>
              <Plus size={14} strokeWidth={1.75} />
              Create "{trimmed}"
            </button>
          )}
          {options.length === 0 && !canCreate && (
            <span className="note">Type a name to create a tag.</span>
          )}
        </div>
      )}
    </div>
  );
}
