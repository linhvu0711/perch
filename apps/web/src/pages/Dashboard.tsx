import { addDays, DEFAULT_TIMEZONE, postCalendarTime, zonedParts } from '@perch/core';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { AttentionRow } from '@/components/AttentionRow';
import { Empty } from '@/components/Empty';
import { PostRow } from '@/components/PostRow';
import { errorMessage } from '@/lib/api';
import { formatDayTitle, formatMonthTitle, formatSchedule, formatUsd } from '@/lib/format';
import { useAccount, useCalendar, usePosts, useSettings, useStatus } from '@/lib/queries';

function greeting(now: Date, timezone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(
      now,
    ),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard() {
  const settings = useSettings();
  const account = useAccount();
  const status = useStatus();
  const attention = usePosts({ needs_attention: true });
  const timezone = settings.data?.timezone ?? DEFAULT_TIMEZONE;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const today = zonedParts(now, timezone).date;
  const calendar = useCalendar({ from: today, to: addDays(today, 3) });

  const dayLong = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).format(now);

  const snapshot = status.data;
  const attentionTotal =
    (snapshot?.missed_count ?? 0) + (snapshot?.failed_count ?? 0) + (snapshot?.due_soon_count ?? 0);
  const attentionItems = attention.data?.pages.flatMap((page) => page.items) ?? [];
  const attentionListTotal = attention.data?.pages[0]?.total ?? 0;

  const upcomingDays = (calendar.data?.days ?? [])
    .map((day) => ({
      date: day.date,
      posts: day.posts.filter((post) => {
        const at = postCalendarTime(post);
        return at !== null && new Date(at) >= now && post.status !== 'published';
      }),
    }))
    .filter((day) => day.posts.length > 0);

  const loadError = status.isError
    ? status.error
    : attention.isError
      ? attention.error
      : calendar.isError
        ? calendar.error
        : null;

  return (
    <>
      <div className="head">
        <h1>{greeting(now, timezone)}</h1>
        <span className="muted">
          {dayLong} · {time} {timezone}
        </span>
      </div>
      {account.data &&
        (account.data.account == null ? (
          <div className="banner missed" role="status">
            <TriangleAlert size={16} strokeWidth={1.75} />
            No X account connected. Scheduled posts will be missed until you connect one.
            <Link className="btn sm" to="/settings">
              Connect X
            </Link>
          </div>
        ) : account.data.account.reconnect_required ? (
          <div className="banner missed" role="status">
            <TriangleAlert size={16} strokeWidth={1.75} />X account @{account.data.account.username}{' '}
            needs to be reconnected. Scheduled posts will be missed until you do.
            <Link className="btn sm" to="/settings">
              Reconnect X
            </Link>
          </div>
        ) : null)}
      {loadError !== null ? (
        <Empty title="Could not load the dashboard" text={errorMessage(loadError)} />
      ) : (
        <>
          <div className="stats">
            <div className="card stat">
              <div className="lbl">Next official post</div>
              <div className="val">
                {status.isPending
                  ? '…'
                  : snapshot?.next_official?.scheduled_at != null
                    ? formatSchedule(snapshot.next_official.scheduled_at, timezone)
                    : '—'}
              </div>
              <div className="sub">
                {snapshot?.next_official?.title ?? 'nothing official scheduled'}
              </div>
            </div>
            <div className="card stat">
              <div className="lbl">Needs attention</div>
              <div className={`val ${attentionTotal > 0 ? 'warn' : 'ok'}`}>
                {status.isPending ? '…' : attentionTotal}
              </div>
              <div className="sub">
                {snapshot === undefined
                  ? ''
                  : `${snapshot.missed_count} missed · ${snapshot.failed_count} failed · ${snapshot.due_soon_count} draft due soon`}
              </div>
            </div>
            <div className="card stat">
              <div className="lbl">Scheduled, next 7 days</div>
              <div className="val">
                {status.isPending
                  ? '…'
                  : (snapshot?.week_official_count ?? 0) + (snapshot?.week_draft_count ?? 0)}
              </div>
              <div className="sub">
                {snapshot === undefined
                  ? ''
                  : `${snapshot.week_official_count} official · ${snapshot.week_draft_count} drafts`}
              </div>
            </div>
            <div className="card stat">
              <div className="lbl">Cost, {formatMonthTitle(today).split(' ')[0]}</div>
              <div className="val">
                {status.isPending ? '…' : formatUsd(snapshot?.month_cost_usd ?? 0)}
              </div>
              <div className="sub">this month</div>
            </div>
          </div>
          <div className="section">
            <h2>
              Needs attention
              <small>missed, failed, or still a draft with a time in the next 3 days</small>
            </h2>
            <div className="card list">
              {attention.isPending ? (
                <div className="empty">
                  <b>Loading…</b>
                </div>
              ) : attentionItems.length === 0 ? (
                <div className="empty">
                  <b>All clear</b>Nothing missed, nothing failed, no drafts due soon.
                </div>
              ) : (
                <>
                  {attentionItems.slice(0, 10).map((post) => (
                    <AttentionRow key={post.id} post={post} />
                  ))}
                  {attentionListTotal > 10 && (
                    <div className="loadmore">
                      <Link to="/posts?status=attention">
                        See all {attentionListTotal} in Posts
                      </Link>
                    </div>
                  )}
                </>
              )}
            </div>
            {attentionItems.length > 0 && (
              <div className="note">
                Dismiss clears the time (missed or due-soon draft) or moves the post back to drafts
                (failed). Nothing is deleted.
              </div>
            )}
          </div>
          <div className="section">
            <h2>
              Next 3 days<small>until {formatDayTitle(addDays(today, 3))}</small>
            </h2>
            <div className="card list">
              {upcomingDays.length === 0 ? (
                <div className="empty">
                  <b>Nothing scheduled</b>No posts in the next 3 days.
                </div>
              ) : (
                upcomingDays.map((day) => (
                  <div key={day.date}>
                    <div className="dayhead">{formatDayTitle(day.date)}</div>
                    {day.posts.map((post) => (
                      <PostRow key={post.id} post={post} />
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
