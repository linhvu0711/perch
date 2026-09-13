import { X_COSTS_USD } from '@perch/core';
import { Check, TriangleAlert, X } from 'lucide-react';
import { type JSX, useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';

import { errorMessage } from '@/lib/api';
import { formatUsd } from '@/lib/format';
import { useSaveTweets } from '@/lib/queries';
import { IconButton } from './IconButton';
import { toast } from './Toast';

export function SaveTweetsModal(): JSX.Element {
  const titleId = useId();
  const navigate = useNavigate();
  const mutation = useSaveTweets();
  const [value, setValue] = useState('');
  const urls = value
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean);
  const close = () => {
    if (mutation.isPending) return;
    navigate('/resources');
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  async function save(): Promise<void> {
    try {
      const data = await mutation.mutateAsync({ urls, refresh: false });
      const saved = data.results.filter(
        (result) => result.ok && result.status !== 'existing',
      ).length;
      toast(`Saved ${saved} of ${urls.length}`);
    } catch (error) {
      toast(errorMessage(error), 'warn');
    }
  }

  const results = mutation.data?.results;
  const saved = results?.filter((result) => result.ok && result.status !== 'existing').length ?? 0;

  return (
    <div
      className="scrim top"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div className="modal sm" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="mhead">
          <b id={titleId}>Save tweets</b>
          <div className="right">
            <IconButton label="Close" icon={X} variant="ghost" onClick={close} />
          </div>
        </div>
        <div className="sbody">
          <div className="field">
            <label>
              Tweet URLs <span className="faint">one per line</span>
            </label>
            <textarea
              className="urls"
              aria-label="Tweet URLs"
              placeholder="https://x.com/user/status/123…"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (mutation.data) mutation.reset();
              }}
            />
          </div>
          <div className="note">
            Reading a tweet costs <b>{formatUsd(X_COSTS_USD.saveTweet)}</b>. A URL already saved is
            free and returns the existing resource. Tweets with images, video, articles, replies,
            quotes, or retweets are rejected.
          </div>
          {results !== undefined && (
            <div className="results">
              {results.map((result) => {
                const color = !result.ok
                  ? 'var(--failed)'
                  : result.status === 'existing'
                    ? 'var(--text-2)'
                    : 'var(--published)';
                const Icon = result.ok ? Check : TriangleAlert;
                const message = result.ok
                  ? result.status === 'created'
                    ? `Saved · #${result.resource.id}`
                    : result.status === 'existing'
                      ? `Already saved · #${result.resource.id}`
                      : `Refreshed · #${result.resource.id}`
                  : result.error.message;
                return (
                  <div className="result" style={{ color }} key={result.url}>
                    <Icon size={16} strokeWidth={1.75} />
                    <span className="u">{result.url}</span>
                    <span>{message}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="sfoot">
          <span className="left">
            {results !== undefined
              ? `${saved} saved · charged ${formatUsd(saved * X_COSTS_USD.saveTweet)}`
              : urls.length > 0
                ? `${urls.length} URL${urls.length === 1 ? '' : 's'} · up to ${formatUsd(
                    urls.length * X_COSTS_USD.saveTweet,
                  )}`
                : ''}
          </span>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          {results === undefined ? (
            <button
              type="button"
              className="btn primary"
              disabled={urls.length === 0 || mutation.isPending}
              onClick={() => void save()}
            >
              Save
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={close}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
