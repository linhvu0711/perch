import { useState, type FormEvent } from 'react';
import { Feather } from 'lucide-react';

import { toast } from '@/components/Toast';
import { ApiError } from '@/lib/api';
import { useLogin } from '@/lib/queries';

export function Login() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const login = useLogin();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    try {
      await login.mutateAsync(token);
      toast('Signed in');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setError('Wrong token.');
      else setError(`Could not sign in: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand">
          <span className="logo"><Feather size={16} strokeWidth={1.75} /></span>
          <span>Perch</span>
        </div>
        <div className="field">
          <label htmlFor="token">Access token</label>
          <input id="token" type="password" placeholder="PERCH_TOKEN" autoFocus autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} />
          <span className="note">The single shared secret from the server config. The CLI uses the same one.</span>
          {error && <span className="error" role="alert">{error}</span>}
        </div>
        <button className="btn primary" type="submit" disabled={login.isPending || token === ''}>Sign in</button>
      </form>
    </div>
  );
}
