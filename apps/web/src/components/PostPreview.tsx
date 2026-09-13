import { DEFAULT_TIMEZONE, foldPreview, type Post, previewSegments } from '@perch/core';
import { useState } from 'react';

import { formatDateTime } from '@/lib/format';
import { useSettings } from '@/lib/queries';

function Segments({ text }: { text: string }) {
  const segments = previewSegments(text);
  let start = 0;
  return (
    <>
      {segments.map((segment) => {
        const key = start;
        start += segment.text.length + 1;
        return segment.kind === 'text' ? (
          <span key={key}>{segment.text}</span>
        ) : (
          <span key={key} className="xc blue">
            {segment.text}
          </span>
        );
      })}
    </>
  );
}

export function PostPreview({ post }: { post: Post }) {
  const timeZone = useSettings().data?.timezone ?? DEFAULT_TIMEZONE;
  const [expanded, setExpanded] = useState(false);
  const fold = foldPreview(post.text);
  const visible = expanded ? post.text : fold.visible;
  const paragraphs = visible.split('\n\n');
  let offset = 0;

  return (
    <div className="xcard">
      <div className="av" />
      <div>
        <div className="name">
          <b>You</b>
          <span>@you · {post.scheduled_at ? 'scheduled' : 'now'}</span>
        </div>
        <div className="text">
          {post.text === '' ? (
            <span className="faint">Nothing yet.</span>
          ) : (
            <>
              {(() => {
                let start = 0;
                return paragraphs.map((paragraph, index) => {
                  const key = start;
                  start += paragraph.length + 2;
                  return (
                    <p key={key}>
                      <Segments text={paragraph} />
                      {!expanded && fold.folded && index === paragraphs.length - 1 ? '…' : ''}
                    </p>
                  );
                });
              })()}
              {fold.folded && (
                <button
                  type="button"
                  className="more"
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </>
          )}
        </div>
        {post.media.length > 0 && (
          <div className={`imgs n${post.media.length}`}>
            {post.media.map((media) => (
              <img key={media.id} src={`/api/posts/${post.id}/media/${media.id}/file`} alt="" />
            ))}
          </div>
        )}
        <div className="meta">
          {post.scheduled_at ? formatDateTime(post.scheduled_at, timeZone) : 'Not scheduled'}
        </div>
      </div>
    </div>
  );
}
