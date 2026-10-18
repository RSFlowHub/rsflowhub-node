'use client';

// React client component: calls your own route (/api/sentiment), never RSFlowHub directly.
import { useState } from 'react';

export default function Page() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ sentiment?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function analyze() {
    setLoading(true);
    const res = await fetch('/api/sentiment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    setResult(await res.json());
    setLoading(false);
  }

  return (
    <main>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a review..." />
      <button onClick={analyze} disabled={loading || !text}>{loading ? 'Analyzing…' : 'Analyze sentiment'}</button>
      {result && <p>Sentiment: {result.sentiment}</p>}
    </main>
  );
}
