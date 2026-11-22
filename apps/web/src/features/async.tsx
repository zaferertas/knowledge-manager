import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

type Result<T> = { data?: T; error?: string };

export function useLoad<T>(load: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ load: typeof load; attempt: number; value: Result<T> }>();
  useEffect(() => {
    let active = true;
    const finish = (value: Result<T>) => {
      if (active) setResult({ load, attempt, value });
    };
    void load().then((data) => finish({ data }), (error) => finish({ error: errorMessage(error) }));
    return () => { active = false; };
  }, [load, attempt]);
  return {
    result: result?.load === load && result.attempt === attempt ? result.value : {},
    retry: () => setAttempt((previous) => previous + 1),
  };
}

export function LoadStatus({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <div><p role="alert">{error}</p><button onClick={retry}>Try again</button></div>
    : <p role="status">Loading…</p>;
}
