import type { ResourceType } from '@perch/core';
import {
  Bird,
  BookmarkPlus,
  FilePlus,
  FileText,
  Image,
  LayoutGrid,
  Search,
  Upload,
} from 'lucide-react';
import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';

import { Empty } from '@/components/Empty';
import { IconButton } from '@/components/IconButton';
import { ResourceCard } from '@/components/ResourceCard';
import { UploadImagesModal } from '@/components/UploadImagesModal';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { RESOURCES_PAGE_SIZE, useResources, useTweetAuthors } from '@/lib/queries';

export function Resources() {
  const navigate = useNavigate();
  const [type, setType] = useState<ResourceType | undefined>();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [author, setAuthor] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'most' | 'least'>('newest');
  const [uploadOpen, setUploadOpen] = useState(false);
  const authors = useTweetAuthors();
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const filters = useMemo(
    () => ({
      ...(type !== undefined ? { type } : {}),
      ...(debouncedSearch !== '' ? { search: debouncedSearch } : {}),
      ...(author !== '' ? { author } : {}),
      sort: sort === 'most' || sort === 'least' ? ('used' as const) : ('created' as const),
      order: sort === 'oldest' || sort === 'least' ? ('asc' as const) : ('desc' as const),
    }),
    [author, type, debouncedSearch, sort],
  );
  const resources = useResources(filters);
  const items = resources.data?.pages.flatMap((page) => page.items) ?? [];
  const total = Math.max(resources.data?.pages[0]?.total ?? 0, items.length);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && resources.hasNextPage && !resources.isFetching) {
        void resources.fetchNextPage();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [resources.fetchNextPage, resources.hasNextPage, resources.isFetching]);

  let content: JSX.Element;
  if (resources.isPending) {
    content = <div className="countline">Loading…</div>;
  } else if (resources.isError) {
    content = <Empty title="Could not load resources" text={errorMessage(resources.error)} />;
  } else if (total === 0 && type === undefined && search === '') {
    content = <Empty title="No resources yet" text="Upload images or create a note." />;
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
            <span>
              · {Math.min(RESOURCES_PAGE_SIZE, left)} of {left} left
            </span>
          </div>
        )}
        <div ref={sentinelRef} style={{ height: 1 }} />
        <div className="countline">
          {items.length} of {total} resources
        </div>
      </>
    );
  }

  return (
    <>
      <div className="head">
        <h1>Resources</h1>
        <IconButton label="Upload images" icon={Upload} onClick={() => setUploadOpen(true)} />
        <IconButton
          label="New note"
          icon={FilePlus}
          variant="primary"
          onClick={() => navigate('/resources/new')}
        />
        <IconButton
          label="Save tweets"
          icon={BookmarkPlus}
          onClick={() => navigate('/resources/save-tweets')}
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
                aria-label="Tweets"
                aria-pressed={type === 'tweet'}
                onClick={() => setType('tweet')}
              >
                <Bird size={16} strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Tweets</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Images"
                aria-pressed={type === 'image'}
                onClick={() => setType('image')}
              >
                <Image size={16} strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Images</TooltipContent>
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
        <select
          className="sel"
          aria-label="Author"
          value={author}
          disabled={type === 'md'}
          onChange={(event) => setAuthor(event.target.value)}
        >
          <option value="">Any author</option>
          {(authors.data?.authors ?? []).map((item) => (
            <option key={item.username} value={item.username}>
              @{item.username} ({item.count})
            </option>
          ))}
        </select>
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
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as 'newest' | 'oldest' | 'most' | 'least')
                }
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="most">Most used</option>
                <option value="least">Least used</option>
              </select>
            </TooltipTrigger>
            <TooltipContent>Sort</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {content}
      <UploadImagesModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <Outlet />
    </>
  );
}
