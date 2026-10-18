import { AbortError, APIError, ConnectionError, RSFlowHubError, isRecord } from './errors.js';
import { RSFlowHubResponse } from './response.js';
import { VERSION } from './version.js';

/** Per-call options, passed as the last argument of any method. */
export interface RequestOptions {
  /** Cancel the request (e.g. when a React component unmounts). */
  signal?: AbortSignal;
  /** Milliseconds before the call fails with a ConnectionError. */
  timeout?: number;
  /** Retries for 429 / 502 / 503 / 504 and network errors. */
  maxRetries?: number;
  /** Extra headers for this call. */
  headers?: Record<string, string>;
}

export interface TransportConfig {
  apiKey: string;
  baseURL: string;
  timeout: number;
  maxRetries: number;
  headers: Record<string, string>;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

const RETRY_STATUSES = [429, 502, 503, 504];

/** @internal */
export class Transport {
  constructor(private readonly config: TransportConfig) {}

  async send(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<RSFlowHubResponse> {
    method = method.toUpperCase();
    const url = buildURL(this.config.baseURL, path, query);
    const maxRetries = options.maxRetries ?? this.config.maxRetries;
    const timeout = options.timeout ?? this.config.timeout;

    const headers: Record<string, string> = {
      'X-API-Key': this.config.apiKey,
      Accept: 'application/json',
      ...this.config.headers,
      ...options.headers,
    };
    // Browsers do not allow setting User-Agent; send our own header everywhere.
    headers['X-RSFlowHub-Client'] = `rsflowhub-node/${VERSION}`;

    let payload: BodyInit | undefined;
    if (body && method !== 'GET' && Object.keys(body).length > 0) {
      if (hasFile(body)) {
        payload = toFormData(body);
      } else {
        payload = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
      }
    }

    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted) throw new AbortError('Request aborted.', { cause: options.signal.reason });

      const controller = new AbortController();
      const onAbort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);

      let response: Response;
      try {
        response = await this.config.fetch(url, { method, headers, body: payload, signal: controller.signal });
      } catch (error) {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        if (options.signal?.aborted) throw new AbortError('Request aborted.', { cause: error });
        if (attempt < maxRetries) {
          await this.config.sleep(backoff(attempt, null));
          continue;
        }
        const timedOut = controller.signal.aborted;
        throw new ConnectionError(
          timedOut ? `Request to RSFlowHub timed out after ${timeout} ms.` : `Could not reach RSFlowHub: ${(error as Error)?.message ?? error}`,
          { cause: error },
        );
      }

      try {
        if (RETRY_STATUSES.includes(response.status) && attempt < maxRetries) {
          await response.body?.cancel().catch(() => undefined);
          await this.config.sleep(backoff(attempt, response.headers.get('retry-after')));
          continue;
        }

        return await toResponse(response);
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      }
    }
  }
}

async function toResponse(response: Response): Promise<RSFlowHubResponse> {
  const text = await response.text();
  let body: unknown = {};
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!isRecord(body)) {
    if (response.status >= 400) throw APIError.from(response.status, response.headers, {}, response.statusText);
    throw new RSFlowHubError(`RSFlowHub returned a non-JSON response (HTTP ${response.status}).`);
  }

  if (response.status >= 400 || body.success === false) {
    throw APIError.from(response.status, response.headers, body, response.statusText);
  }

  return new RSFlowHubResponse(body, response.status, response.headers);
}

/** Milliseconds to wait: Retry-After when given (capped at 60 s), else 0.5 s, 1 s, 2 s ... plus jitter. */
function backoff(attempt: number, retryAfter: string | null): number {
  if (retryAfter !== null && retryAfter !== '' && Number.isFinite(Number(retryAfter))) {
    return Math.min(60_000, Math.max(0, Number(retryAfter) * 1000));
  }
  return Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function buildURL(baseURL: string, path: string, query?: Record<string, unknown>): string {
  const url = `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  if (!query) return url;

  const params = new URLSearchParams();
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => add(`${key}[${i}]`, v));
    else if (isRecord(value)) Object.entries(value).forEach(([k, v]) => add(`${key}[${k}]`, v));
    else params.append(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  };
  Object.entries(query).forEach(([k, v]) => add(k, v));
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function isFile(value: unknown): value is Blob | Uint8Array | ArrayBuffer {
  return (
    (typeof Blob !== 'undefined' && value instanceof Blob) ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer
  );
}

function hasFile(body: Record<string, unknown>): boolean {
  return Object.values(body).some(isFile);
}

/** multipart/form-data; nested values become name[key] (what Laravel's "array" rule reads). */
function toFormData(body: Record<string, unknown>): FormData {
  const form = new FormData();
  const add = (name: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (isFile(value)) {
      const blob = value instanceof Blob ? value : new Blob([value as BlobPart]);
      const filename = typeof File !== 'undefined' && blob instanceof File ? blob.name : name;
      form.append(name, blob, filename);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => add(`${name}[${i}]`, v));
    } else if (isRecord(value)) {
      Object.entries(value).forEach(([k, v]) => add(`${name}[${k}]`, v));
    } else {
      form.append(name, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
  };
  Object.entries(body).forEach(([k, v]) => add(k, v));
  return form;
}
