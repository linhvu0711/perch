import {
  addDays,
  CALENDAR_DAY_CAP,
  DEFAULT_TIMEZONE,
  monthGrid,
  monthOf,
  postCalendarTime,
  zonedParts,
} from '@perch/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Empty } from '@/components/Empty';
import { IconButton } from '@/components/IconButton';
import { TagFilter } from '@/components/TagFilter';
import { errorMessage } from '@/lib/api';
import { formatMonthTitle } from '@/lib/format';
import { useCalendar, useSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';

const LEGEND_STATUSES = ['draft', 'official', 'published', 'failed', 'missed'] as const;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Calendar() {
  const timeZone = useSettings().data?.timezone ?? DEFAULT_TIMEZONE;
  const [anchor, setAnchor] = useState(() => zonedParts(new Date(), timeZone).date);
  const [tag, setTag] = useState<string | undefined>();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const today = zonedParts(now, timeZone).date;
  const cells = monthGrid(anchor);
  const range = useCalendar({
    from: cells[0] ?? anchor,
    to: cells[cells.length - 1] ?? anchor,
    ...(tag !== undefined ? { tag: [tag] } : {}),
  });
  const byDay = new Map((range.data?.days ?? []).map((day) => [day.date, day.posts]));

  let body;
  if (range.isPending) {
    body = <div className="countline">Loading…</div>;
  } else if (range.isError) {
    body = <Empty title="Could not load calendar" text={errorMessage(range.error)} />;
  } else {
    body = (
      <div className="card cal">
        <div className="dow">
          {DOW.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="days">
          {cells.map((cell) => {
            const posts = byDay.get(cell) ?? [];
            const show = posts.slice(0, CALENDAR_DAY_CAP);
            const out = cell.slice(0, 7) !== anchor.slice(0, 7);
            return (
              <div
                key={cell}
                className={cn(
                  'day',
                  out && 'out',
                  cell === today ? 'today' : cell < today && 'past',
                )}
              >
                <span className="n">{Number(cell.slice(8))}</span>
                {show.map((post) => {
                  const at = postCalendarTime(post);
                  return (
                    <Link
                      key={post.id}
                      to={`/calendar/${post.id}`}
                      className={cn('ev', post.missed ? 'missed' : post.status)}
                    >
                      <i className="dot" />
                      <span className="t">
                        {at === null ? '' : zonedParts(new Date(at), timeZone).time}
                      </span>
                      <span className="s">{post.title !== '' ? post.title : 'Empty post'}</span>
                    </Link>
                  );
                })}
                {posts.length > show.length && (
                  <button type="button" className="ev moreev" title="Open this week">
                    +{posts.length - show.length} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="head">
        <div className="calnav">
          <h1>{formatMonthTitle(anchor)}</h1>
          <IconButton
            label="Previous month"
            icon={ChevronLeft}
            onClick={() => setAnchor(addDays(monthOf(anchor).from, -1))}
          />
          <IconButton
            label="Next month"
            icon={ChevronRight}
            onClick={() => setAnchor(addDays(monthOf(anchor).to, 1))}
          />
          <button type="button" className="btn ghost sm" onClick={() => setAnchor(today)}>
            Today
          </button>
        </div>
        <div className="legend">
          {LEGEND_STATUSES.map((s) => (
            <span key={s}>
              <i className={s} />
              {s}
            </span>
          ))}
        </div>
      </div>
      <div className="filters">
        <TagFilter value={tag} kind="post" onChange={setTag} />
      </div>
      {body}
    </>
  );
}
