import { DEFAULT_TIMEZONE } from '@perch/core';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { LogOut, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import { IconButton } from '@/components/IconButton';
import { toast } from '@/components/Toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { useLogout, useSettings, useUpdateSettings } from '@/lib/queries';
import { useTheme, type Theme } from '@/lib/theme';

function ThemeChoice({ label, icon: Icon, value, theme, setTheme }: { label: string; icon: LucideIcon; value: Theme; theme: Theme; setTheme(value: Theme): void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} aria-pressed={theme === value} onClick={() => { setTheme(value); toast(`Theme: ${label}`); }}>
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
  const [theme, setTheme] = useTheme();
  const savedLimit = settings.data?.char_limit_override ?? null;
  const [limit, setLimit] = useState('');

  useEffect(() => setLimit(savedLimit === null ? '' : String(savedLimit)), [savedLimit]);

  const timezone = settings.data?.timezone ?? DEFAULT_TIMEZONE;
  const timezones = useMemo(() => {
    const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [DEFAULT_TIMEZONE, timezone];
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
    if (limit !== '' && !/^\d+$/.test(limit)) {
      toast('Enter a whole number', 'warn');
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
      <div className="head"><h1>Settings</h1><IconButton label="Sign out" icon={LogOut} variant="ghost" onClick={signOut} /></div>
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
            <div className="card set">
              <div><div className="k">Time zone</div><div className="d">All times are shown and entered in this zone.</div></div>
              <select aria-label="Time zone" value="" disabled><option value="" /></select>
            </div>
            <div className="card set">
              <div><div className="k">Character limit</div><div className="d">Set from your X plan when you connect. Override if needed.</div></div>
              <input aria-label="Character limit" className="mono" value="" disabled readOnly />
            </div>
            <div className="card set">
              <div><div className="k">Theme</div><div className="d">Follows your system by default.</div></div>
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
            <div className="card set">
              <div><div className="k">Time zone</div><div className="d">All times are shown and entered in this zone.</div></div>
              <select value={timezone} onChange={(event) => void saveTimezone(event.target.value)}>{timezones.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            </div>
            <div className="card set">
              <div><div className="k">Character limit</div><div className="d">Set from your X plan when you connect. Override if needed.</div></div>
              <input className="mono" inputMode="numeric" placeholder="280" value={limit} onChange={(event) => setLimit(event.target.value)} onBlur={() => void saveLimit()} onKeyDown={submitLimit} />
            </div>
            <div className="card set">
              <div><div className="k">Theme</div><div className="d">Follows your system by default.</div></div>
              <div className="seg icons">
                <ThemeChoice label="Light" icon={Sun} value="light" theme={theme} setTheme={setTheme} />
                <ThemeChoice label="System" icon={Monitor} value="system" theme={theme} setTheme={setTheme} />
                <ThemeChoice label="Dark" icon={Moon} value="dark" theme={theme} setTheme={setTheme} />
              </div>
            </div>
          </div>
          <div className="col" />
        </div>
      )}
    </>
  );
}
