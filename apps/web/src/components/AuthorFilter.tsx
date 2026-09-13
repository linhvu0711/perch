import { AtSign, ChevronDown, Search } from 'lucide-react';
import { type JSX, useEffect, useRef, useState } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useResourceAuthors } from '@/lib/queries';

export function AuthorFilter(props: {
  value: string | undefined;
  disabled: boolean;
  onChange(value: string | undefined): void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const authors = useResourceAuthors();

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

  const list = (authors.data?.authors ?? []).filter((author) =>
    author.username.toLowerCase().includes(query.toLowerCase()),
  );

  const pick = (username: string | undefined) => {
    props.onChange(username);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="btn sm"
            aria-label="Filter by tweet author"
            aria-pressed={props.value !== undefined}
            aria-haspopup="menu"
            disabled={props.disabled}
            onClick={() => {
              setQuery('');
              setOpen((current) => !current);
            }}
          >
            <AtSign size={16} strokeWidth={1.75} />
            {props.value}
            <ChevronDown size={16} strokeWidth={1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Filter by tweet author</TooltipContent>
      </Tooltip>
      {open && (
        <div className="menu" role="menu">
          <div className="search">
            <Search size={16} strokeWidth={1.75} />
            <input
              aria-label="Find an author"
              placeholder="Find an author"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={props.value === undefined}
            onClick={() => pick(undefined)}
          >
            Any author
          </button>
          <hr />
          {list.length === 0 ? (
            <div className="note">No tweet authors yet</div>
          ) : (
            list.map((author) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={props.value === author.username}
                key={author.username}
                onClick={() => pick(author.username)}
              >
                @{author.username}
                <span className="n">{author.count}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
