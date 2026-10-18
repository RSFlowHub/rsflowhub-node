import { RSFlowHubError, isRecord } from './errors.js';
import type { Resources } from './generated/types.js';
import { Operations } from './operations.js';
import type { RSFlowHubResponse } from './response.js';
import { Transport, type RequestOptions } from './transport.js';

export const DEFAULT_BASE_URL = 'https://rsflowhub.com/api/v1';

export interface ClientOptions {
  /** Your API key (rfh_...). Defaults to process.env.RSFLOWHUB_API_KEY. */
  apiKey?: string;
  /** Defaults to process.env.RSFLOWHUB_BASE_URL or https://rsflowhub.com/api/v1. */
  baseURL?: string;
  /** Milliseconds per attempt. Default 60 000. */
  timeout?: number;
  /** Retries for 429 / 502 / 503 / 504 and network errors. Default 2. */
  maxRetries?: number;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** Your own fetch (proxies, logging, tests, older runtimes). */
  fetch?: typeof fetch;
  /** Look up unknown non-AI methods in the live OpenAPI document. Default true. */
  liveSpec?: boolean;
  /**
   * Your API key spends your credits. In a browser anyone can read it, so the
   * client refuses to start there unless you set this (e.g. for an internal tool).
   * Call RSFlowHub from your server instead (Next.js route handler, Express, ...).
   */
  dangerouslyAllowBrowser?: boolean;
  /** @internal used between retries; tests pass a no-op */
  sleep?: (ms: number) => Promise<void>;
}

type Id = string | number;

/**
 * Official JavaScript / TypeScript client for the RSFlowHub AI API.
 *
 * ```ts
 * const client = new RSFlowHub({ apiKey: process.env.RSFLOWHUB_API_KEY });
 * const res = await client.ai.sentimentAnalysis({ text: 'Loved it!' });
 * console.log(res.result.sentiment);
 * ```
 *
 * Methods are not hard-coded: any AI endpoint, including ones added after this
 * release, is `client.ai.camelCaseSlug({...})`.
 */
export class RSFlowHub {
  declare readonly ai: Resources['ai'];
  declare readonly knowledgeBases: Resources['knowledgeBases'];
  declare readonly chatbots: Resources['chatbots'];
  declare readonly faqCollections: Resources['faqCollections'];
  declare readonly account: Resources['account'];
  declare readonly system: Resources['system'];

  readonly baseURL: string;

  private readonly transport: Transport;
  private readonly operations: Operations;
  private readonly resources = new Map<string, any>();

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? env('RSFLOWHUB_API_KEY');
    if (!apiKey || apiKey.trim() === '') {
      throw new RSFlowHubError(
        "No RSFlowHub API key. Pass new RSFlowHub({ apiKey: 'rfh_...' }) or set RSFLOWHUB_API_KEY. " +
          'Create one at https://rsflowhub.com/dashboard.',
      );
    }
    if (isBrowser() && !options.dangerouslyAllowBrowser) {
      throw new RSFlowHubError(
        'RSFlowHub is running in a browser, where anyone can read your API key and spend your credits. ' +
          'Call it from your server (Next.js route handler / server action, Express, ...) and fetch that from React. ' +
          'If you understand the risk (internal tool), pass { dangerouslyAllowBrowser: true }.',
      );
    }

    const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl) {
      throw new RSFlowHubError('No fetch() found. Use Node.js 18+ or pass { fetch } in the options.');
    }

    this.baseURL = (options.baseURL ?? env('RSFLOWHUB_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.transport = new Transport({
      apiKey,
      baseURL: this.baseURL,
      timeout: options.timeout ?? 60_000,
      maxRetries: Math.max(0, options.maxRetries ?? 2),
      headers: options.headers ?? {},
      fetch: fetchImpl,
      sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    });
    this.operations = new Operations(this.transport, options.liveSpec ?? true);

    for (const name of ['ai', 'knowledgeBases', 'chatbots', 'faqCollections', 'account', 'system']) {
      Object.defineProperty(this, name, { get: () => this.resource(name), enumerable: true });
    }
  }

  /**
   * Call any route directly:
   * `client.request('POST', '/ai/translation', { text: 'Hello', target_language: 'French' })`.
   * A Blob / File / Uint8Array value turns the body into multipart/form-data.
   */
  request<T = Record<string, any>>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<RSFlowHubResponse<T>> {
    return this.transport.send(method, path, body, query, options) as Promise<RSFlowHubResponse<T>>;
  }

  /**
   * A resource by name, including ones newer than this SDK:
   * `client.resource('webhooks').list()`.
   */
  resource<K extends keyof Resources>(name: K): Resources[K];
  resource(name: string): Record<string, (...args: any[]) => Promise<RSFlowHubResponse>>;
  resource(name: string): any {
    let proxy = this.resources.get(name);
    if (!proxy) {
      proxy = new Proxy(
        {},
        {
          get: (_target, method) => {
            if (typeof method !== 'string' || method === 'then' || method === 'toJSON') return undefined;
            return (...args: unknown[]) => this.dispatch(name, method, args);
          },
        },
      );
      this.resources.set(name, proxy);
    }
    return proxy;
  }

  /**
   * Call a method by name: `client.call('ai', 'brandNewEndpoint', { ... })`.
   * Same as `client.ai.brandNewEndpoint({ ... })`, but always type-checks
   * (also under `noUncheckedIndexedAccess`).
   */
  call<T = Record<string, any>>(resource: string, method: string, ...args: unknown[]): Promise<RSFlowHubResponse<T>> {
    return this.dispatch(resource, method, args) as Promise<RSFlowHubResponse<T>>;
  }

  private async dispatch(resource: string, method: string, args: unknown[]): Promise<RSFlowHubResponse> {
    const [httpMethod, template] = await this.operations.find(resource, method);

    const ids: Id[] = [];
    let params: Record<string, unknown> = {};
    let options: RequestOptions | undefined;
    let i = 0;
    for (; i < args.length && (typeof args[i] === 'string' || typeof args[i] === 'number'); i++) ids.push(args[i] as Id);
    if (isRecord(args[i]) && !(i === args.length - 1 && isOptions(args[i]))) params = { ...(args[i++] as Record<string, unknown>) };
    if (isRecord(args[i])) options = args[i++] as RequestOptions;

    const path = template.replace(/\{([^}]+)\}/g, (_m, name: string) => {
      let value: unknown;
      if (ids.length) value = ids.shift();
      else if (name in params) {
        value = params[name];
        delete params[name];
      } else throw new RSFlowHubError(`${resource}.${method}() needs the "${name}" path parameter.`);
      if ((typeof value !== 'string' && typeof value !== 'number') || String(value) === '') {
        throw new RSFlowHubError(`${resource}.${method}(): "${name}" must be a non-empty id.`);
      }
      return encodeURIComponent(String(value));
    });
    if (ids.length) throw new RSFlowHubError(`${resource}.${method}() got more ids than its path ${template} takes.`);

    return httpMethod === 'GET'
      ? this.transport.send(httpMethod, path, undefined, params, options)
      : this.transport.send(httpMethod, path, params, undefined, options);
  }
}

const OPTION_KEYS = ['signal', 'timeout', 'maxRetries', 'headers'];

/** get(id, { signal }) passes options without params; no API field uses these names. */
function isOptions(value: unknown): boolean {
  const keys = Object.keys(value as object);
  return keys.length > 0 && keys.every((k) => OPTION_KEYS.includes(k));
}

function env(name: string): string | undefined {
  let value: unknown = (globalThis as any).process?.env?.[name];
  if (value === undefined) {
    try {
      value = (globalThis as any).Deno?.env?.get?.(name);
    } catch {
      // Deno without --allow-env
    }
  }
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isBrowser(): boolean {
  return typeof (globalThis as any).window !== 'undefined' && typeof (globalThis as any).document !== 'undefined';
}
