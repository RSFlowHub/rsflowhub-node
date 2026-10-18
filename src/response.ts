import { isRecord } from './errors.js';

export interface RateLimit {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
}

/**
 * A successful API answer: `{ success: true, request_id, data, meta }`.
 *
 * AI endpoints put their output in `data.result`; `res.result` returns it
 * (or `data` itself for routes without a `result`, like knowledge bases).
 */
export class RSFlowHubResponse<TData = Record<string, any>> {
  /** Everything under `data`. */
  readonly data: TData;
  /** `{ version, timestamp }` */
  readonly meta: Record<string, unknown>;
  /** Server request id. Quote it when you contact support. */
  readonly requestId: string | null;
  readonly status: number;
  readonly headers: Headers;
  /** The full decoded JSON body. */
  readonly body: Record<string, unknown>;

  constructor(body: Record<string, unknown>, status: number, headers: Headers) {
    this.body = body;
    this.status = status;
    this.headers = headers;
    this.data = (isRecord(body.data) || Array.isArray(body.data) ? body.data : { value: body.data ?? null }) as TData;
    this.meta = isRecord(body.meta) ? body.meta : {};
    this.requestId = typeof body.request_id === 'string' ? body.request_id : headers.get('x-request-id');
  }

  /** The AI output (`data.result`), or `data` when there is no `result`. */
  get result(): any {
    const data = this.data as unknown;
    return isRecord(data) && 'result' in data ? data.result : data;
  }

  /** Read from `data` with dot notation: `res.get('result.aspects.0.name')`. */
  get<T = any>(path: string, fallback?: T): T {
    let value: any = this.data;
    for (const key of path.split('.')) {
      if (value === null || typeof value !== 'object' || !(key in value)) return fallback as T;
      value = value[key];
    }
    return value as T;
  }

  /** Your rate-limit state after this call (X-RateLimit-* headers). */
  get rateLimit(): RateLimit {
    const num = (name: string) => {
      const v = this.headers.get(name);
      return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
    };
    return { limit: num('x-ratelimit-limit'), remaining: num('x-ratelimit-remaining'), reset: num('x-ratelimit-reset') };
  }

  toJSON(): Record<string, unknown> {
    return this.body;
  }
}
