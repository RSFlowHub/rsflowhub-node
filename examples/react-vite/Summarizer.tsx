// React (Vite / CRA) component. It calls YOUR backend (see examples/express),
// which calls RSFlowHub with the secret key. Never put rfh_ keys in frontend code.
import { useEffect, useState } from 'react';

export function Summarizer({ text }: { text: string }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => (data.error ? setError(data.error) : setSummary(data.summary ?? JSON.stringify(data))))
      .catch((e) => e.name !== 'AbortError' && setError(String(e)));
    return () => controller.abort();
  }, [text]);

  if (error) return <p role="alert">{error}</p>;
  return <p>{summary ?? 'Summarizing…'}</p>;
}
