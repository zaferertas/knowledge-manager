import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [status, setStatus] = useState('Checking API connection…');

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);

    async function checkApi() {
      try {
        const response = await fetch('/api/v1/health', { signal });
        if (!response.ok || (await response.json()).status !== 'ok') {
          throw new Error('Unexpected health response');
        }
        setStatus('API connected');
      } catch {
        if (!controller.signal.aborted) setStatus('API unavailable');
      }
    }

    void checkApi();
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Knowledge Hub</h1>
      <p role="status">{status}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
