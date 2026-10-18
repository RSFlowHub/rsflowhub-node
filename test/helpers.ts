import { RSFlowHub, type ClientOptions } from '../src/index.js';

export interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: BodyInit | null | undefined;
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function ok(data: unknown = {}, headers: Record<string, string> = {}): Response {
  return json(200, { success: true, request_id: 'req_123', data, meta: { version: 'v1' } }, headers);
}

export function apiError(status: number, code: string, message: string, details: unknown = {}, headers: Record<string, string> = {}): Response {
  return json(status, { success: false, request_id: 'req_err', error: { code, message, details }, meta: { version: 'v1' } }, headers);
}

/** A client whose fetch answers from a queue and records every call. */
export function mockClient(options: ClientOptions = {}) {
  const queue: Array<Response | Error> = [];
  const calls: Call[] = [];
  const sleeps: number[] = [];

  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), method: init.method ?? 'GET', headers: new Headers(init.headers), body: init.body });
    const next = queue.shift();
    if (!next) throw new Error('mock fetch: no response queued');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof globalThis.fetch;

  const client = new RSFlowHub({
    apiKey: 'rfh_test1234_secret',
    baseURL: 'https://api.test/api/v1',
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...options,
  });

  return {
    client,
    calls,
    sleeps,
    queue: (...responses: Array<Response | Error>) => queue.push(...responses),
    last: () => calls[calls.length - 1]!,
    lastJson: () => JSON.parse(String(calls[calls.length - 1]!.body)),
  };
}
