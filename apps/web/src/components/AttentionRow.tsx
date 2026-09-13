import { DEFAULT_TIMEZONE, type Post } from '@perch/core';
import { Check } from 'lucide-react';
import { Link } from 'react-router';

import { errorMessage } from '@/lib/api';
import { formatDateTime, formatDayMonth } from '@/lib/format';
import { useDismissPosts, useSettings } from '@/lib/queries';

import { IconButton } from './IconButton';
import { StatusPill } from './StatusPill';
import { toast } from './Toast';

export function AttentionRow({ post }: { post: Post }) {
  const timeZone = useSettings().data?.timezone ?? DEFAULT_TIMEZONE;
  const dismiss = useDismissPosts();
  const time = post.scheduled_at ?? post.published_at;
  const firstLine = post.text.split('\n', 1)[0]?.trim() ?? '';

  const onDismiss = () => {
    dismiss.mutate([post.id], {
      onSuccess: (data) => {
        const result = data.results.find((entry) => entry.id === post.id);
        if (result?.ok === true) {
          toast(post.status === 'failed' ? 'Moved to drafts. Time cleared.' : 'Time cleared.');
        } else {
          toast(result?.ok === false ? result.error.message : 'Could not dismiss', 'warn');
        }
      },
      onError: (error) => toast(errorMessage(error), 'warn'),
    });
  };

  return (
    <div className="row">
      <Link to={`/posts/${post.id}`} className="rowlink">
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
      </Link>
      <span className="why">{post.reason}</span>
      <StatusPill status={post.missed ? 'missed' : post.status} />
      <IconButton
        label={
          post.status === 'failed' ? 'Dismiss: move back to drafts' : 'Dismiss: clear the time'
        }
        icon={Check}
        variant="ghost"
        size="sm"
        disabled={dismiss.isPending}
        onClick={onDismiss}
      />
    </div>
  );
}
