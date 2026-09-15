import {
  ATTENTION_WINDOW_DAYS,
  addDays,
  DEFAULT_TIMEZONE,
  postCalendarTime,
  STATUS_WEEK_DAYS,
  X_COSTS_USD,
  zonedParts,
} from '@perch/core';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { AttentionRow } from '@/components/AttentionRow';
import { Empty } from '@/components/Empty';
import { IconButton } from '@/components/IconButton';
import { PostRow } from '@/components/PostRow';
import { errorMessage } from '@/lib/api';
import { formatDayTitle, formatMonthTitle, formatSchedule, formatUsd } from '@/lib/format';
import {
  useAccount,
  useCalendar,
  useCostMonths,
  useCostSummary,
  usePosts,
  useSettings,
  useStatus,
} from '@/lib/queries';

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
  const costSummary = useCostSummary();
  const [cursors, setCursors] = useState<string[]>([]);
  const costMonths = useCostMonths(cursors[cursors.length - 1]);
  const timezone = settings.data?.timezone ?? DEFAULT_TIMEZONE;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (attention.hasNextPage && !attention.isFetching) void attention.fetchNextPage();
  }, [attention.fetchNextPage, attention.hasNextPage, attention.isFetching]);

  const today = zonedParts(now, timezone).date;
  const calendar = useCalendar({ from: today, to: addDays(today, ATTENTION_WINDOW_DAYS) });

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
  const attentionTotal = (snapshot?.missed_count ?? 0) + (snapshot?.failed_count ?? 0);
  const attentionItems = attention.data?.pages.flatMap((page) => page.items) ?? [];
  const costPage = cursors.length;
  const costItems = costMonths.data?.items ?? [];
  const costTotal = costMonths.data?.total ?? 0;
  const costFirst = costPage * 6 + 1;
  const costLast = costFirst + costItems.length - 1;
  const costSummaryData = costSummary.data;

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
        : costSummary.isError
          ? costSummary.error
          : costMonths.isError
            ? costMonths.error
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
              <div className="lbl">Issues</div>
              <div className={`val ${attentionTotal > 0 ? 'warn' : 'ok'}`}>
                {status.isPending ? '…' : attentionTotal}
              </div>
              <div className="sub">
                {snapshot === undefined
                  ? ''
                  : `${snapshot.missed_count} missed · ${snapshot.failed_count} failed`}
              </div>
            </div>
            <div className="card stat">
              <div className="lbl">Scheduled, next {STATUS_WEEK_DAYS} days</div>
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
              <div className="lbl">
                Cost,{' '}
                {
                  formatMonthTitle(`${costSummaryData?.month ?? today.slice(0, 7)}-01`).split(
                    ' ',
                  )[0]
                }
              </div>
              <div className="val">
                {costSummary.isPending ? '…' : formatUsd(costSummaryData?.total_usd ?? 0)}
              </div>
              <div className="sub">
                {costSummaryData === undefined
                  ? ''
                  : `${costSummaryData.calls} X API ${costSummaryData.calls === 1 ? 'call' : 'calls'}`}
              </div>
            </div>
          </div>
          <div className="section">
            <h2>
              Next {ATTENTION_WINDOW_DAYS} days
              <small>until {formatDayTitle(addDays(today, ATTENTION_WINDOW_DAYS))}</small>
            </h2>
            <div className="card list">
              {upcomingDays.length === 0 ? (
                <div className="empty">
                  <b>Nothing scheduled</b>No posts in the next {ATTENTION_WINDOW_DAYS} days.
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
          <div className="section">
            <h2>
              Issues<small>missed or failed</small>
            </h2>
            <div className="card list">
              {attention.isPending ? (
                <div className="empty">
                  <b>Loading…</b>
                </div>
              ) : attentionItems.length === 0 ? (
                <div className="empty">
                  <b>All clear</b>Nothing missed, nothing failed.
                </div>
              ) : (
                <>
                  {attentionItems.map((post) => (
                    <AttentionRow key={post.id} post={post} />
                  ))}
                </>
              )}
            </div>
            {attentionItems.length > 0 && (
              <div className="note">
                Dismiss clears the time (missed) or moves the post back to drafts (failed). Nothing
                is deleted.
              </div>
            )}
          </div>
          <div className="section">
            <h2>
              Cost by month<small>X API, pay-per-use</small>
            </h2>
            <div className="card">
              {costMonths.isPending ? (
                <div className="empty">
                  <b>Loading…</b>
                </div>
              ) : costTotal === 0 ? (
                <div className="empty">
                  <b>No X API calls yet</b>Costs appear here after the first publish, tweet save, or
                  connect.
                </div>
              ) : (
                <>
                  <table className="t">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th className="num">Publish</th>
                        <th className="num">Save tweet</th>
                        <th className="num">Connect</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costItems.map((row) => (
                        <tr
                          key={row.month}
                          className={row.month === costSummaryData?.month ? 'cur' : ''}
                        >
                          <td>{formatMonthTitle(`${row.month}-01`)}</td>
                          <td className="num">{formatUsd(row.publish_usd)}</td>
                          <td className="num">{formatUsd(row.save_tweet_usd)}</td>
                          <td className="num">{formatUsd(row.connect_usd)}</td>
                          <td className="num">{formatUsd(row.total_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="pager">
                    <span>
                      {costFirst}–{costLast} of {costTotal} months · all time{' '}
                      {formatUsd(costSummaryData?.all_time_usd ?? 0)}
                    </span>
                    <IconButton
                      label="Newer months"
                      icon={ChevronLeft}
                      size="sm"
                      disabled={costPage === 0 || costMonths.isFetching}
                      onClick={() => setCursors((current) => current.slice(0, -1))}
                    />
                    <IconButton
                      label="Older months"
                      icon={ChevronRight}
                      size="sm"
                      disabled={costMonths.data?.next_cursor == null || costMonths.isFetching}
                      onClick={() => {
                        const next = costMonths.data?.next_cursor;
                        if (next != null) setCursors((current) => [...current, next]);
                      }}
                    />
                  </div>
                </>
              )}
            </div>
            <div className="note" style={{ marginTop: 8 }}>
              Publish {formatUsd(X_COSTS_USD.publish)} · publish with a link{' '}
              {formatUsd(X_COSTS_USD.publishWithUrl)} · save a tweet{' '}
              {formatUsd(X_COSTS_USD.saveTweet)} · connect {formatUsd(X_COSTS_USD.getMe)} · image
              upload free.
            </div>
          </div>
        </>
      )}
    </>
  );
}
