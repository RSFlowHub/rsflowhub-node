# Changelog

## 1.0.0

- First release: dynamic client for every RSFlowHub API (`client.ai.<slug>`), knowledge bases, chatbots, FAQ collections and account.
- Zero dependencies (built-in `fetch`), ESM + CommonJS, generated TypeScript types for every method.
- Typed errors from the API error code; retries with backoff for 429/502/503/504 and network errors; timeouts and `AbortSignal`.
- Live OpenAPI lookup for methods newer than the SDK; refuses to run in a browser unless `dangerouslyAllowBrowser`.
