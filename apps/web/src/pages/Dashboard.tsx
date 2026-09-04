import { useEffect, useState } from 'react';
import { DEFAULT_TIMEZONE } from '@perch/core';

import { Empty } from '@/components/Empty';
import { useSettings } from '@/lib/queries';

function greeting(now: Date, timezone: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(now));
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard() {
  const settings = useSettings();
  const timezone = settings.data?.timezone ?? DEFAULT_TIMEZONE;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const dayLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone }).format(now);

  return (
    <>
      <div className="head">
        <h1>{greeting(now, timezone)}</h1>
        <span className="muted">{dayLong} · {time} {timezone}</span>
      </div>
      <Empty title="Nothing here yet" text="Stat cards and the needs-attention list will show up here." />
    </>
  );
}
