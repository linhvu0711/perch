import { useState, type JSX } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router';

import { errorMessage } from '@/lib/api';
import { useSaveTweets } from '@/lib/queries';
import { toast } from './Toast';

export function SaveTweetsModal(): JSX.Element {
  const navigate = useNavigate();
  const mutation = useSaveTweets();
  const [value, setValue] = useState('');
  const urls = value.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
  const close = () => navigate('/resources');
  async function save(): Promise<void> {
    try {
      const result = await mutation.mutateAsync({ urls });
      const saved = result.results.filter((item) => item.ok && item.status !== 'existing').length;
      toast(`Saved ${saved} of ${urls.length}`);
    } catch (error) {
      toast(errorMessage(error), 'warn');
    }
  }
  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Save tweets">
        <div className="mhead"><b>Save tweets</b><button type="button" onClick={close} aria-label="Close"><X size={16} /></button></div>
        <div className="rbody"><div className="rmain">
          <p className="muted">$0.015 per URL. Duplicate URLs are free.</p>
          <p className="muted">Posts with media, articles, retweets, replies, and quotes are rejected.</p>
          <textarea aria-label="Tweet URLs" rows={8} value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://x.com/user/status/123" />
          <p className="muted">{urls.length} URL{urls.length === 1 ? '' : 's'} · maximum charge ${(urls.length * 0.015).toFixed(3)}</p>
          <button type="button" className="btn primary" disabled={urls.length === 0 || mutation.isPending} onClick={() => void save()}>Save</button>
          {mutation.data && <div className="results">{mutation.data.results.map((result) => (
            <div key={result.url}>{result.ok ? `${result.status === 'created' ? 'Saved' : result.status === 'existing' ? 'Already saved' : 'Refreshed'} · #${result.resource.id}` : result.error.message}</div>
          ))}</div>}
        </div></div>
      </div>
    </div>
  );
}
