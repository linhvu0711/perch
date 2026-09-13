import { ChevronDown, Search, Tag } from 'lucide-react';
import { type JSX, useEffect, useRef, useState } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTags } from '@/lib/queries';

export function TagFilter(props: {
  value: string | undefined;
  kind: 'resource' | 'post';
  disabled?: boolean;
  onChange(value: string | undefined): void;
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

  const list = (tags.data?.items ?? []).filter(
    (tag) =>
      (props.kind === 'resource' ? tag.resource_count : tag.post_count) > 0 &&
      tag.name.toLowerCase().includes(query.toLowerCase()),
  );

  const pick = (name: string | undefined) => {
    props.onChange(name);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="btn sm"
            aria-label="Filter by tag"
            aria-pressed={props.value !== undefined}
            aria-haspopup="menu"
            disabled={props.disabled}
            onClick={() => {
              setQuery('');
              setOpen((current) => !current);
            }}
          >
            <Tag size={16} strokeWidth={1.75} />
            {props.value}
            <ChevronDown size={16} strokeWidth={1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent>Filter by tag</TooltipContent>
      </Tooltip>
      {open && (
        <div className="menu" role="menu">
          <div className="search">
            <Search size={16} strokeWidth={1.75} />
            <input
              aria-label="Find a tag"
              placeholder="Find a tag"
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
            Any tag
          </button>
          <hr />
          {list.length === 0 ? (
            <div className="note">No tags yet</div>
          ) : (
            list.map((tag) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={props.value === tag.name}
                key={tag.id}
                onClick={() => pick(tag.name)}
              >
                {tag.name}
                <span className="n">
                  {props.kind === 'resource' ? tag.resource_count : tag.post_count}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
