import type { JSX } from 'react';
import type { Resource } from '@perch/core';
import { FileText, Image } from 'lucide-react';
import { Link } from 'react-router';

import { formatBytes, formatDayMonth, noteExcerpt } from '@/lib/format';

export function ResourceCard({ resource }: { resource: Resource }): JSX.Element {
  const isImage = resource.type === 'image';
  const excerpt = resource.type === 'md' ? noteExcerpt(resource.body) : '';
  return (
    <Link to={`/resources/${resource.id}`} className="card res">
      <div className="top">
        <span className="kind">
          {isImage ? (
            <>
              <Image />
              Image
            </>
          ) : (
            <>
              <FileText />
              Note
            </>
          )}
        </span>
        <span className="date">{formatDayMonth(resource.created_at)}</span>
      </div>
      {isImage && (
        <img
          className="thumb"
          src={`/api/resources/${resource.id}/file`}
          alt={resource.title}
        />
      )}
      <div className="title">{resource.title}</div>
      {isImage ? (
        <div className="body">{formatBytes(resource.bytes)}</div>
      ) : (
        excerpt && <div className="body">{excerpt}</div>
      )}
      <div className="foot">
        <span className="uses">
          {!resource.used_by
            ? 'not used'
            : `used by ${resource.used_by} post${resource.used_by === 1 ? '' : 's'}`}
        </span>
      </div>
    </Link>
  );
}
