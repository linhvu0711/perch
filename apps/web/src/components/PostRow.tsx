import type { Post } from '@perch/core';
import { Link } from 'react-router';

import { formatDateTime, formatDayMonth } from '@/lib/format';

import { StatusPill } from './StatusPill';

export function PostRow({ post }: { post: Post }) {
  const time = post.scheduled_at ?? post.published_at;
  const firstLine = post.text.split('\n', 1)[0]?.trim() ?? '';

  return (
    <Link to={`/posts/${post.id}`} className="row">
      <div className="when">
        {time === null ? (
          <span className="muted">no time</span>
        ) : (
          <>
            <b>{formatDayMonth(time)}</b>
            {formatDateTime(time)}
          </>
        )}
      </div>
      <div className="txt">
        {post.title !== '' && <b>{post.title}</b>}
        {firstLine !== '' && (
          <span className={post.title !== '' ? 'muted' : undefined}>
            {firstLine}
          </span>
        )}
        {post.title === '' && firstLine === '' && (
          <span className="faint">Empty post</span>
        )}
      </div>
      <span className="pid">#{post.id}</span>
      <StatusPill status={post.status} />
    </Link>
  );
}
