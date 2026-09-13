import { DEFAULT_TIMEZONE, type Post } from '@perch/core';
import { Link } from 'react-router';

import { formatDateTime, formatDayMonth } from '@/lib/format';
import { useSettings } from '@/lib/queries';

import { StatusPill } from './StatusPill';

export function PostRow({ post }: { post: Post }) {
  const timeZone = useSettings().data?.timezone ?? DEFAULT_TIMEZONE;
  const time = post.scheduled_at ?? post.published_at;
  const firstLine = post.text.split('\n', 1)[0]?.trim() ?? '';

  return (
    <Link to={`/posts/${post.id}`} className="row">
      <div className="when">
        {time === null ? (
          <span className="muted">no time</span>
        ) : (
          <>
            <b>{formatDayMonth(time, timeZone)}</b>
            {formatDateTime(time, timeZone)}
          </>
        )}
      </div>
      <div className="txt">
        {post.title !== '' && <b>{post.title}</b>}
        {firstLine !== '' && firstLine !== post.title && (
          <span className={post.title !== '' ? 'muted' : undefined}>{firstLine}</span>
        )}
        {post.title === '' && firstLine === '' && <span className="faint">Empty post</span>}
      </div>
      <span className="pid">#{post.id}</span>
      <StatusPill status={post.status} />
    </Link>
  );
}
