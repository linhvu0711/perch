import {
  CHAR_LIMIT_DEFAULT,
  CHAR_LIMIT_MAX,
  charLimitOverrideSchema,
  DEFAULT_TIMEZONE,
  formatCost,
  X_COSTS_USD,
} from '@perch/core';
import { LogOut, type LucideIcon, Monitor, Moon, Sun } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconButton } from '@/components/IconButton';
import { toast } from '@/components/Toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import {
  useAccount,
  useConnectX,
  useDisconnectX,
  useLogout,
  useSettings,
  useUpdateSettings,
} from '@/lib/queries';
import { type Theme, useTheme } from '@/lib/theme';

function ThemeChoice({
  label,
  icon: Icon,
  value,
  theme,
  setTheme,
}: {
  label: string;
  icon: LucideIcon;
  value: Theme;
  theme: Theme;
  setTheme(value: Theme): void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={theme === value}
          onClick={() => {
            setTheme(value);
            toast(`Theme: ${label}`);
          }}
        >
          <Icon size={16} strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Settings() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const logout = useLogout();
  const account = useAccount();
  const connect = useConnectX();
  const disconnect = useDisconnectX();
  const [confirm, setConfirm] = useState<'connect' | 'disconnect' | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [theme, setTheme] = useTheme();
  const savedLimit = settings.data?.char_limit_override ?? null;
  const [limit, setLimit] = useState('');

  useEffect(() => setLimit(savedLimit === null ? '' : String(savedLimit)), [savedLimit]);

  useEffect(() => {
    if (searchParams.get('connected') === '1') {
      const connected = account.data?.account;
      if (!connected) return;
      toast(`Connected @${connected.username}`);
      setSearchParams({}, { replace: true });
      return;
    }
    const connectError = searchParams.get('connect_error');
    if (connectError === 'denied') toast('X connection was cancelled.', 'warn');
    if (connectError === 'expired') toast('The connect link expired. Try again.', 'warn');
    if (connectError === 'failed') toast('X connection failed. Try again.', 'warn');
    if (connectError) setSearchParams({}, { replace: true });
  }, [searchParams, account.data, setSearchParams]);

  const accountCard = (
    <div className="card set">
      {account.isError ? (
        <div>
          <div className="k">X account</div>
          <div className="d">{errorMessage(account.error)}</div>
        </div>
      ) : account.data?.account?.reconnect_required ? (
        <>
          <div>
            <div className="k">@{account.data.account.username}</div>
            <div className="d">X rejected the saved token. Reconnect to keep publishing.</div>
          </div>
          <button type="button" className="btn primary" onClick={() => setConfirm('connect')}>
            Reconnect X
          </button>
        </>
      ) : account.data?.account ? (
        <>
          <div>
            <div className="k">@{account.data.account.username}</div>
            <div className="d">
              {account.data.account.subscription_type} ·{' '}
              {account.data.char_limit.toLocaleString('en-US')} characters · connected{' '}
              {new Intl.DateTimeFormat('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              }).format(new Date(account.data.account.connected_at))}
            </div>
          </div>
          <button type="button" className="btn danger" onClick={() => setConfirm('disconnect')}>
            Disconnect
          </button>
        </>
      ) : (
        <>
          <div>
            <div className="k">No account connected</div>
            <div className="d">
              Connect an X account to publish. One account at a time. Costs{' '}
              {formatCost(X_COSTS_USD.getMe)} once.
            </div>
          </div>
          <button type="button" className="btn primary" onClick={() => setConfirm('connect')}>
            Connect X
          </button>
        </>
      )}
    </div>
  );

  const timezone = settings.data?.timezone ?? DEFAULT_TIMEZONE;
  const timezones = useMemo(() => {
    const supported =
      typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : [DEFAULT_TIMEZONE, timezone];
    const values = new Set(supported);
    values.add(DEFAULT_TIMEZONE);
    values.add(timezone);
    return [...values].sort();
  }, [timezone]);

  async function saveTimezone(value: string): Promise<void> {
    try {
      await update.mutateAsync({ timezone: value });
      toast('Time zone saved');
    } catch (error) {
      toast(errorMessage(error), 'warn');
    }
  }

  async function saveLimit(): Promise<void> {
    const saved = savedLimit === null ? '' : String(savedLimit);
    if (limit === saved) return;
    if (limit !== '' && !charLimitOverrideSchema.safeParse(Number(limit)).success) {
      toast(`Enter a whole number from 1 to ${CHAR_LIMIT_MAX.toLocaleString('en-US')}`, 'warn');
      setLimit(saved);
      return;
    }
    const value = limit === '' ? null : Number(limit);
    try {
      await update.mutateAsync({ char_limit_override: value });
      toast(value === null ? 'Character limit cleared' : 'Character limit saved');
    } catch (error) {
      toast(errorMessage(error), 'warn');
      setLimit(saved);
    }
  }

  function submitLimit(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') event.currentTarget.blur();
  }

  async function signOut(): Promise<void> {
    try {
      await logout.mutateAsync();
      toast('Signed out');
    } catch (error) {
      toast(errorMessage(error), 'warn');
    }
  }

  return (
    <>
      <div className="head">
        <h1>Settings</h1>
        <IconButton label="Sign out" icon={LogOut} variant="ghost" onClick={signOut} />
      </div>
      {settings.isError ? (
        <div className="card">
          <div className="empty">
            <b>Could not load settings</b>
            {errorMessage(settings.error)}
          </div>
        </div>
      ) : !settings.data ? (
        <div className="settings">
          <div className="col">
            {accountCard}
            <div className="card set">
              <div>
                <div className="k">Time zone</div>
                <div className="d">All times are shown and entered in this zone.</div>
              </div>
              <select aria-label="Time zone" value="" disabled>
                <option value="" />
              </select>
            </div>
            <div className="card set">
              <div>
                <div className="k">Character limit</div>
                <div className="d">Set from your X plan when you connect. Override if needed.</div>
              </div>
              <input aria-label="Character limit" className="mono" value="" disabled readOnly />
            </div>
            <div className="card set">
              <div>
                <div className="k">Theme</div>
                <div className="d">Follows your system by default.</div>
              </div>
              <div className="seg icons">
                <button type="button" aria-label="Light" disabled />
                <button type="button" aria-label="System" disabled />
                <button type="button" aria-label="Dark" disabled />
              </div>
            </div>
          </div>
          <div className="col" />
        </div>
      ) : (
        <div className="settings">
          <div className="col">
            {accountCard}
            <div className="card set">
              <div>
                <div className="k">Time zone</div>
                <div className="d">All times are shown and entered in this zone.</div>
              </div>
              <select value={timezone} onChange={(event) => void saveTimezone(event.target.value)}>
                {timezones.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div className="card set">
              <div>
                <div className="k">Character limit</div>
                <div className="d">Set from your X plan when you connect. Override if needed.</div>
              </div>
              <input
                className="mono"
                inputMode="numeric"
                placeholder={String(CHAR_LIMIT_DEFAULT)}
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                onBlur={() => void saveLimit()}
                onKeyDown={submitLimit}
              />
            </div>
            <div className="card set">
              <div>
                <div className="k">Theme</div>
                <div className="d">Follows your system by default.</div>
              </div>
              <div className="seg icons">
                <ThemeChoice
                  label="Light"
                  icon={Sun}
                  value="light"
                  theme={theme}
                  setTheme={setTheme}
                />
                <ThemeChoice
                  label="System"
                  icon={Monitor}
                  value="system"
                  theme={theme}
                  setTheme={setTheme}
                />
                <ThemeChoice
                  label="Dark"
                  icon={Moon}
                  value="dark"
                  theme={theme}
                  setTheme={setTheme}
                />
              </div>
            </div>
          </div>
          <div className="col" />
        </div>
      )}
      {confirm === 'connect' && (
        <ConfirmDialog
          title="Connect an X account"
          body={
            <p>
              You will be sent to X to approve Perch. Scopes: read and write posts, upload media,
              read your profile. The plan check costs <b>{formatCost(X_COSTS_USD.getMe)}</b> once.
            </p>
          }
          ok="Continue to X"
          onCancel={() => setConfirm(null)}
          onOk={() => {
            void (async () => {
              try {
                const { authorize_url } = await connect.mutateAsync();
                window.location.assign(authorize_url);
              } catch (error) {
                setConfirm(null);
                toast(errorMessage(error), 'warn');
              }
            })();
          }}
        />
      )}
      {confirm === 'disconnect' && account.data?.account && (
        <ConfirmDialog
          title={`Disconnect @${account.data.account.username}?`}
          body={
            <p>
              Scheduled official posts will be <b>missed</b> until you connect an account again.
              Nothing is deleted.
            </p>
          }
          ok="Disconnect"
          danger
          busy={disconnect.isPending}
          onCancel={() => setConfirm(null)}
          onOk={() => {
            void (async () => {
              try {
                await disconnect.mutateAsync();
                setConfirm(null);
                toast('Disconnected');
              } catch (error) {
                setConfirm(null);
                toast(errorMessage(error), 'warn');
              }
            })();
          }}
        />
      )}
    </>
  );
}
