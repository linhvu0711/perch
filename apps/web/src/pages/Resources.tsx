import { useEffect, useMemo, useRef, useState } from 'react';
import type { ResourceType } from '@perch/core';
import { FilePlus, FileText, LayoutGrid, Search } from 'lucide-react';
import { Outlet, useNavigate } from 'react-router';

import { Empty } from '@/components/Empty';
import { IconButton } from '@/components/IconButton';
import { ResourceCard } from '@/components/ResourceCard';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { RESOURCES_PAGE_SIZE, useResources } from '@/lib/queries';

export function Resources() {
  const navigate = useNavigate();
  const [type, setType] = useState<ResourceType | undefined>();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const filters = useMemo(
    () => ({
      ...(type !== undefined ? { type } : {}),
      ...(debouncedSearch !== '' ? { search: debouncedSearch } : {}),
      order,
    }),
    [type, debouncedSearch, order],
  );
  const resources = useResources(filters);
  const items = resources.data?.pages.flatMap((page) => page.items) ?? [];
  const total = Math.max(resources.data?.pages[0]?.total ?? 0, items.length);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (
        entries[0]?.isIntersecting &&
        resources.hasNextPage &&
        !resources.isFetching
      ) {
        void resources.fetchNextPage();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [resources.fetchNextPage, resources.hasNextPage, resources.isFetching]);

  let content;
  if (resources.isPending) {
    content = <div className="countline">Loading…</div>;
  } else if (resources.isError) {
    content = (
      <Empty title="Could not load resources" text={errorMessage(resources.error)} />
    );
  } else if (total === 0 && type === undefined && search === '') {
    content = <Empty title="No notes yet" text="Create one with the New note button." />;
  } else if (total === 0) {
    content = <Empty title="No resources match" text="Change a filter or the search." />;
  } else {
    const left = total - items.length;
    content = (
      <>
        <div className="grid">
          {items.map((resource) => (
            <ResourceCard key={resource.id} resource={resource} />
          ))}
        </div>
        {resources.hasNextPage && (
          <div className="loadmore">
            <button
              type="button"
              disabled={resources.isFetchingNextPage}
              onClick={() => void resources.fetchNextPage()}
            >
              Load more
            </button>
            <span>· {Math.min(RESOURCES_PAGE_SIZE, left)} of {left} left</span>
          </div>
        )}
        <div ref={sentinelRef} style={{ height: 1 }} />
        <div className="countline">{items.length} of {total} resources</div>
      </>
    );
  }

  return (
    <>
      <div className="head">
        <h1>Resources</h1>
        <IconButton
          label="New note"
          icon={FilePlus}
          variant="primary"
          onClick={() => navigate('/resources/new')}
        />
      </div>
      <div className="filters">
        <div className="seg icons" role="group" aria-label="Type">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="All"
                aria-pressed={type === undefined}
                onClick={() => setType(undefined)}
              >
                <LayoutGrid size={16} strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent>All</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Notes"
                aria-pressed={type === 'md'}
                onClick={() => setType('md')}
              >
                <FileText size={16} strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Notes</TooltipContent>
          </Tooltip>
        </div>
        <div className="search">
          <Search size={16} strokeWidth={1.75} />
          <input
            aria-label="Search"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="right">
          <Tooltip>
            <TooltipTrigger asChild>
              <select
                className="sel"
                aria-label="Sort"
                value={order}
                onChange={(event) => setOrder(event.target.value as 'asc' | 'desc')}
              >
                <option value="desc">Newest</option>
                <option value="asc">Oldest</option>
              </select>
            </TooltipTrigger>
            <TooltipContent>Sort</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {content}
      <Outlet />
    </>
  );
}
