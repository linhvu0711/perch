import type { JSX } from 'react';
import type { Resource } from '@perch/core';
import { FileText } from 'lucide-react';
import { Link } from 'react-router';

import { formatDayMonth, noteExcerpt } from '@/lib/format';

export function ResourceCard({ resource }: { resource: Resource }): JSX.Element {
  const excerpt = noteExcerpt(resource.type === 'md' ? resource.body : '');
  return (
    <Link to={`/resources/${resource.id}`} className="card res">
      <div className="top">
        <span className="kind">
          <FileText />Note
        </span>
        <span className="date">{formatDayMonth(resource.created_at)}</span>
      </div>
      <div className="title">{resource.title}</div>
      {excerpt && <div className="body">{excerpt}</div>}
      <div className="foot">
        <span className="uses">not used</span>
      </div>
    </Link>
  );
}
