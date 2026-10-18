# RSFlowHub JavaScript & TypeScript SDK

[![npm](https://img.shields.io/npm/v/rsflowhub.svg)](https://www.npmjs.com/package/rsflowhub)
[![Tests](https://github.com/RSFlowHub/rsflowhub-node/actions/workflows/tests.yml/badge.svg)](https://github.com/RSFlowHub/rsflowhub-node/actions/workflows/tests.yml)
[![Types](https://img.shields.io/npm/types/rsflowhub.svg)](https://www.npmjs.com/package/rsflowhub)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

The official JavaScript / TypeScript library for the [RSFlowHub AI API](https://rsflowhub.com). Add sentiment analysis, translation, AI chat, PII redaction, spam and comment moderation, review and support-ticket AI, knowledge-base search (RAG) and chatbots to **Node.js, Next.js, React, Vue, Nuxt, SvelteKit, Express, NestJS, Bun, Deno, Cloudflare Workers and Vercel Edge** with one API key.

- **Never out of date.** Methods are not hard-coded. A new RSFlowHub API works the day it ships: `client.ai.newEndpointName({...})`. No SDK upgrade needed.
- **Zero dependencies.** Uses the built-in `fetch`. ESM and CommonJS builds, full TypeScript types.
- **Typed everything.** Every method has typed parameters with limits in the JSDoc, generated from the [RSFlowHub OpenAPI spec](https://rsflowhub.com/api/v1/openapi.json).
- **Typed errors.** `ValidationError`, `InsufficientCreditsError`, `RateLimitError` and more, each with the API's error code, message and request id.
- **Retries and timeouts.** 429 and temporary 5xx answers are retried with backoff, respecting `Retry-After` (they never charge credits). `AbortSignal` support.

Other languages: [PHP](https://github.com/RSFlowHub/rsflowhub-php) · [Python](https://github.com/RSFlowHub/rsflowhub-python) · [Examples](https://github.com/RSFlowHub/rsflowhub-examples)

## Install

```bash
npm install rsflowhub
```

`yarn add rsflowhub` · `pnpm add rsflowhub` · `bun add rsflowhub` · Deno: `import { RSFlowHub } from 'npm:rsflowhub'`

Get an API key from the [RSFlowHub dashboard](https://rsflowhub.com/dashboard) (free credits included). Node.js 18 or newer.

## Quick start

```ts
import { RSFlowHub } from 'rsflowhub';

const client = new RSFlowHub({ apiKey: process.env.RSFLOWHUB_API_KEY }); // apiKey defaults to that env var

const res = await client.ai.sentimentAnalysis({
  text: 'Setup took two minutes and support answered right away.',
});

console.log(res.result.sentiment); // "positive"
console.log(res.requestId);        // "req_..." quote it when you contact support
```

CommonJS: `const { RSFlowHub } = require('rsflowhub');`

Every API answer is the envelope `{ success, request_id, data, meta }`; AI endpoints put their output in `data.result`. A call returns an `RSFlowHubResponse`:

| | |
| --- | --- |
| `res.result` | the AI output (`data.result`), or `data` when there is none |
| `res.data` | everything under `data` |
| `res.get('result.aspects.0.name')` | dot-path read with an optional fallback |
| `res.requestId`, `res.meta`, `res.status`, `res.headers` | envelope and HTTP details |
| `res.rateLimit` | `{ limit, remaining, reset }` from the `X-RateLimit-*` headers |

## React, Next.js, Vue: keep the key on the server

Your API key spends your credits, and anything in browser code is public. The client **refuses to start in a browser** unless you pass `dangerouslyAllowBrowser: true`. Call RSFlowHub from your server and fetch that from your components:

```ts
// app/api/sentiment/route.ts (Next.js App Router)
import { RSFlowHub } from 'rsflowhub';

const client = new RSFlowHub();

export async function POST(request: Request) {
  const { text } = await request.json();
  const res = await client.ai.sentimentAnalysis({ text });
  return Response.json(res.result);
}
```

```tsx
// any React component
const res = await fetch('/api/sentiment', { method: 'POST', body: JSON.stringify({ text }) });
const { sentiment } = await res.json();
```

Server actions, Remix loaders, Nuxt server routes, SvelteKit `+server.ts`, Express and NestJS work the same way. Full examples: [Next.js](examples/nextjs), [Express](examples/express), [React + Vite](examples/react-vite), [Edge / Workers](examples/edge-worker.ts).

## Calling any API

The method name is the endpoint slug in camelCase:

| API | Call |
| --- | --- |
| `POST /ai/sentiment-analysis` | `client.ai.sentimentAnalysis({ text })` |
| `POST /ai/translation` | `client.ai.translation({ text: 'Hello', target_language: 'French' })` |
| `POST /ai/chat` | `client.ai.chat({ message: 'Hi!' })` |
| `POST /ai/pii-redaction` | `client.ai.piiRedaction({ text: 'Call me on 555-0100' })` |
| `POST /ai/ticket-analyze` | `client.ai.ticketAnalyze({ ticket: 'My order never arrived' })` |
| `POST /ai/any-new-api` | `client.ai.anyNewApi({...})` (works without an SDK update) |

All methods with their parameters: [docs/ENDPOINTS.md](docs/ENDPOINTS.md). API docs: [rsflowhub.com/docs](https://rsflowhub.com/docs).

> Using `noUncheckedIndexedAccess`? A method newer than your installed types is `client.ai.newApi!({...})` or `client.call('ai', 'newApi', {...})`.

### Knowledge bases (RAG) and chatbots

Ids in the URL come first, then the body, then per-call options:

```ts
const kb = await client.knowledgeBases.create({ name: 'Help center' });
const kbId = kb.get('knowledge_base.id');

await client.knowledgeBases.createDocument(kbId, {
  file: await fs.openAsBlob('refund-policy.pdf'), // Node 20+; or a File from an <input>, or a Uint8Array
});

const answer = await client.knowledgeBases.ask(kbId, { question: 'Can I get a refund after 30 days?' });

const reply = await client.chatbots.sendMessage(chatbotId, { message: 'Where is my order?' });
```

A `Blob`, `File`, `Uint8Array`/`Buffer` or `ArrayBuffer` value turns the request into a file upload.

### Any route

```ts
const usage = await client.request('GET', '/account/usage', undefined, { page: 2 });
```

## Errors

```ts
import { APIError, ConnectionError, InsufficientCreditsError, RateLimitError, ValidationError } from 'rsflowhub';

try {
  await client.ai.textSummarize({ text: article });
} catch (error) {
  if (error instanceof ValidationError) console.log(error.errors);          // { text: ['The text field is required.'] }
  else if (error instanceof InsufficientCreditsError) console.log(error.requiredCredits, error.availableCredits);
  else if (error instanceof RateLimitError) console.log(error.retryAfter);   // already retried maxRetries times
  else if (error instanceof APIError) console.log(error.status, error.code, error.message, error.requestId);
  else if (error instanceof ConnectionError) console.log('network problem or timeout');
  else throw error;
}
```

| Error | When | Error codes |
| --- | --- | --- |
| `AuthenticationError` | 401 | `API_KEY_MISSING`, `INVALID_API_KEY` |
| `InsufficientCreditsError` | 402 | `INSUFFICIENT_CREDITS` |
| `PermissionDeniedError` | 403 | `SPENDING_LIMIT_REACHED`, `USER_INACTIVE` |
| `NotFoundError` | 404 | `ENDPOINT_NOT_FOUND` |
| `ValidationError` | 422 | `VALIDATION_ERROR` |
| `RateLimitError` | 429 | `RATE_LIMIT_EXCEEDED` |
| `InternalServerError` | 500 | `INTERNAL_SERVER_ERROR` |
| `ServiceUnavailableError` | 502 / 503 | `PROVIDER_UNAVAILABLE`, `AI_PROVIDER_ERROR` |
| `ConnectionError` | no answer / timeout | |
| `AbortError` | your `AbortSignal` fired | |

All of them extend `RSFlowHubError`.

## Options

```ts
const client = new RSFlowHub({
  apiKey: 'rfh_...',                       // default: process.env.RSFLOWHUB_API_KEY
  baseURL: 'https://rsflowhub.com/api/v1', // default: process.env.RSFLOWHUB_BASE_URL
  timeout: 60_000,                         // ms per attempt
  maxRetries: 2,                           // for 429, 502, 503, 504 and network errors
  headers: {},                             // extra headers on every request
  fetch: customFetch,                      // proxies, logging, tests, older runtimes
  liveSpec: true,                          // look up unknown non-AI methods in the live OpenAPI spec
});

// per call: last argument
const controller = new AbortController();
await client.ai.chat({ message: 'Hi' }, { signal: controller.signal, timeout: 10_000, maxRetries: 0 });
await client.knowledgeBases.get(12, { signal: controller.signal });
```

## How it stays up to date

RSFlowHub publishes a machine-readable [OpenAPI document](https://rsflowhub.com/api/v1/openapi.json) generated from the API's own routes and validation rules. This SDK uses it in three ways:

1. **AI endpoints** are called by name, so new ones work at once.
2. **Other new routes** (for example a new knowledge-base action) are looked up in the live document the first time you call them.
3. **Types and docs** (`src/generated`, `docs/ENDPOINTS.md`) are regenerated every week by a GitHub workflow that opens a pull request when the API changed.

To regenerate by hand: `npm run generate` (or `node scripts/generate.mjs <url-or-file>`).

## Contributing

Issues and pull requests are welcome: `npm install`, `npm test`, `npm run typecheck`, `npm run build`. Do not edit generated files (`src/generated`, `docs/ENDPOINTS.md`); change `scripts/generate.mjs` instead.

## License

MIT. See [LICENSE](LICENSE).
