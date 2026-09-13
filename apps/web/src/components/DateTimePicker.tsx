import { zonedParts } from '@perch/core';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { IconButton } from './IconButton';

export function DateTimePicker(props: {
  value: string | null;
  timeZone: string;
  disabled?: boolean;
  onSet(at: string): void;
  onClear(): void;
}) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

  useEffect(() => {
    if (props.value === null) {
      setDate('');
      setTime('');
      return;
    }
    const parts = zonedParts(new Date(props.value), props.timeZone);
    setDate(parts.date);
    setTime(parts.time);
  }, [props.value, props.timeZone]);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time);

  return (
    <div className="inline">
      <input
        className="dt"
        aria-label="Date"
        placeholder="YYYY-MM-DD"
        value={date}
        disabled={props.disabled}
        onChange={(event) => setDate(event.target.value)}
      />
      <input
        className="dt time"
        aria-label="Time"
        placeholder="HH:mm"
        value={time}
        disabled={props.disabled}
        onChange={(event) => setTime(event.target.value)}
      />
      <button
        type="button"
        className="btn sm"
        disabled={!valid || props.disabled}
        onClick={() => props.onSet(`${date} ${time}`)}
      >
        Set
      </button>
      <span className="faint">{props.timeZone}</span>
      {props.value !== null && (
        <IconButton
          label="Clear time"
          icon={X}
          variant="ghost"
          size="sm"
          disabled={props.disabled}
          onClick={props.onClear}
        />
      )}
    </div>
  );
}
