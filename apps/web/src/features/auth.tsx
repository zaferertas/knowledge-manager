import { useState } from 'react';
import { ApiError, createClient, type Session } from '../api/client';
import { LoadStatus, useAction, useLoad } from './async';

const client = createClient();
async function restoreSession() {
  try {
    return await client.me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function SessionGate({ renderWorkspace }: {
  renderWorkspace: (session: Session, onEnd: (expired: boolean) => void) => React.ReactNode;
}) {
  const initial = useLoad(restoreSession);
  const [session, setSession] = useState<Session | null>();
  const [expired, setExpired] = useState(false);
  const current = session === undefined ? initial.result.data : session;
  if (current) {
    return renderWorkspace(current, (endedByExpiry) => {
      setExpired(endedByExpiry);
      setSession(null);
    });
  }
  if (current === undefined) {
    const error = initial.result.error;
    return <main className="auth"><h1>Knowledge Hub</h1><LoadStatus error={error} retry={initial.retry} /></main>;
  }
  return <AuthForm expired={expired} onSession={setSession} />;
}

function AuthForm({ expired, onSession }: { expired: boolean; onSession: (session: Session) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const registering = mode === 'register';
  return (
    <main className="auth">
      <h1>Personal Knowledge Hub</h1>
      {expired && <p role="status">Your session has ended. Sign in again to continue.</p>}
      <CredentialsForm key={mode} mode={mode} onSession={onSession} switchMode={() => setMode(registering ? 'login' : 'register')} />
    </main>
  );
}

function CredentialsForm({ mode, onSession, switchMode }: {
  mode: 'login' | 'register'; onSession: (session: Session) => void; switchMode: () => void;
}) {
  const action = useAction();
  const registering = mode === 'register';
  return (
    <section className="panel">
      <h2>{registering ? 'Create an account' : 'Sign in'}</h2>
      <form onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        void action.run(async () => onSession(await client.authenticate(mode, {
          email: String(fields.get('email')).trim(),
          password: String(fields.get('password')),
        })));
      }}>
        <fieldset disabled={action.busy}>
          <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
          <label>Password<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required aria-describedby={registering ? 'password-help' : undefined} /></label>
          {registering && <p id="password-help">Use at least 12 characters and at most 256 UTF-8 bytes.</p>}
          <button className="primary">{registering ? 'Register' : 'Sign in'}</button>
          <button type="button" onClick={switchMode}>{registering ? 'Back to sign in' : 'Create an account'}</button>
        </fieldset>
        {action.busy && <p role="status">Please wait…</p>}
        {action.error && <p role="alert">{action.error}</p>}
      </form>
    </section>
  );
}
