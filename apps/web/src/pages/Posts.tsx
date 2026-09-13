import type { PostStatus } from '@perch/core';
import {
  CircleAlert,
  CircleCheck,
  LayoutGrid,
  PenLine,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';

import { Empty } from '@/components/Empty';
import { IconButton } from '@/components/IconButton';
import { PostRow } from '@/components/PostRow';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { POSTS_PAGE_SIZE, usePosts } from '@/lib/queries';

const STATUS_TABS: Array<{
  value: PostStatus | undefined;
  dataStatus: string;
  label: string;
  icon: typeof LayoutGrid;
}> = [
  { value: undefined, dataStatus: 'all', label: 'All', icon: LayoutGrid },
  { value: 'draft', dataStatus: 'draft', label: 'Drafts', icon: PenLine },
  { value: 'official', dataStatus: 'official', label: 'Official', icon: ShieldCheck },
  { value: 'published', dataStatus: 'published', label: 'Published', icon: CircleCheck },
  { value: 'failed', dataStatus: 'failed', label: 'Failed', icon: CircleAlert },
];

export function Posts() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PostStatus | undefined>();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const filters = useMemo(
    () => ({
      ...(status !== undefined ? { status } : {}),
      ...(debouncedSearch !== '' ? { search: debouncedSearch } : {}),
    }),
    [status, debouncedSearch],
  );
  const posts = usePosts(filters);
  const items = posts.data?.pages.flatMap((page) => page.items) ?? [];
  const total = Math.max(posts.data?.pages[0]?.total ?? 0, items.length);

  let content;
  if (posts.isPending) {
    content = <div className="countline">Loading…</div>;
  } else if (posts.isError) {
    content = <Empty title="Could not load posts" text={errorMessage(posts.error)} />;
  } else if (total === 0 && status === undefined && search === '') {
    content = <Empty title="No posts yet" text="Create one with the New post button." />;
  } else if (total === 0) {
    content = <Empty title="No posts match" text="Change a filter or the search." />;
  } else {
    const left = total - items.length;
    content = (
      <>
        <div className="card list">
          {items.map((post) => (
            <PostRow key={post.id} post={post} />
          ))}
        </div>
        {posts.hasNextPage && (
          <div className="loadmore">
            <button
              type="button"
              disabled={posts.isFetchingNextPage}
              onClick={() => void posts.fetchNextPage()}
            >
              Load more
            </button>
            <span>
              · {Math.min(POSTS_PAGE_SIZE, left)} of {left} left
            </span>
          </div>
        )}
        <div className="countline">
          {items.length} of {total} posts
        </div>
      </>
    );
  }

  return (
    <>
      <div className="head">
        <h1>Posts</h1>
        <IconButton
          label="New post"
          icon={Plus}
          variant="primary"
          onClick={() => navigate('/posts/new')}
        />
      </div>
      <div className="filters">
        <div className="seg icons" role="group" aria-label="Status">
          {STATUS_TABS.map((tab) => (
            <Tooltip key={tab.dataStatus}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={tab.label}
                  aria-pressed={status === tab.value}
                  data-status={tab.dataStatus}
                  onClick={() => setStatus(tab.value)}
                >
                  <tab.icon size={16} strokeWidth={1.75} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{tab.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="search right">
          <Search size={16} strokeWidth={1.75} />
          <input
            aria-label="Search posts"
            placeholder="Search posts"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {content}
      <Outlet />
    </>
  );
}
