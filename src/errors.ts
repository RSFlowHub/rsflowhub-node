/** Base class of every error thrown by the SDK. */
export class RSFlowHubError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The request never got an answer (DNS, TLS, timeout, offline, CORS). */
export class ConnectionError extends RSFlowHubError {}

/** The request was cancelled with your AbortSignal. */
export class AbortError extends RSFlowHubError {}

/**
 * The API answered with an error envelope:
 * `{ success: false, request_id, error: { code, message, details } }`.
 */
export class APIError extends RSFlowHubError {
  /** HTTP status, e.g. 422. */
  readonly status: number;
  /** Machine-readable error code, e.g. "VALIDATION_ERROR". */
  readonly code: string;
  /** Extra context from the API (for VALIDATION_ERROR: field -> messages). */
  readonly details: Record<string, unknown>;
  /** Server request id. Quote it when you contact support. */
  readonly requestId: string | null;
  readonly headers: Headers;
  /** The decoded JSON body (empty when the server did not send JSON). */
  readonly body: Record<string, unknown>;

  constructor(
    message: string,
    init: {
      status: number;
      code: string;
      details?: Record<string, unknown>;
      requestId?: string | null;
      headers?: Headers;
      body?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
    this.headers = init.headers ?? new Headers();
    this.body = init.body ?? {};
  }

  /** Build the most specific error for an error response. */
  static from(status: number, headers: Headers, body: Record<string, unknown>, statusText = ''): APIError {
    const error = isRecord(body.error) ? body.error : {};
    const code = typeof error.code === 'string' ? error.code : codeForStatus(status);
    const message =
      typeof error.message === 'string'
        ? error.message
        : typeof body.message === 'string'
          ? body.message
          : `HTTP ${status}${statusText ? ' ' + statusText : ''}`;
    const details = isRecord(error.details) ? error.details : {};
    const requestId = typeof body.request_id === 'string' ? body.request_id : headers.get('x-request-id');

    const Ctor = errorClassFor(status, code);
    return new Ctor(message, { status, code, details, requestId, headers, body });
  }
}

/** 401: the API key is missing, invalid or revoked (API_KEY_MISSING, INVALID_API_KEY, UNAUTHORIZED). */
export class AuthenticationError extends APIError {}

/** 402: your balance cannot cover this call (INSUFFICIENT_CREDITS). Nothing was charged. */
export class InsufficientCreditsError extends APIError {
  get requiredCredits(): number | null {
    return toNumber(this.details.required_credits);
  }

  get availableCredits(): number | null {
    return toNumber(this.details.available_credits);
  }
}

/** 403: spending limit reached or account inactive (SPENDING_LIMIT_REACHED, USER_INACTIVE). */
export class PermissionDeniedError extends APIError {}

/** 404: the endpoint or resource does not exist (ENDPOINT_NOT_FOUND). */
export class NotFoundError extends APIError {}

/** 422: the request body failed validation (VALIDATION_ERROR). */
export class ValidationError extends APIError {
  /** Field -> list of messages, e.g. `{ text: ['The text field is required.'] }`. */
  get errors(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [field, messages] of Object.entries(this.details)) {
      out[field] = (Array.isArray(messages) ? messages : [messages]).map(String);
    }
    return out;
  }
}

/** 429: too many requests (RATE_LIMIT_EXCEEDED). Retried automatically up to maxRetries. */
export class RateLimitError extends APIError {
  /** Seconds to wait before the next call, from the Retry-After header. */
  get retryAfter(): number | null {
    return toNumber(this.headers.get('retry-after'));
  }
}

/** 500: unexpected server error (INTERNAL_SERVER_ERROR). */
export class InternalServerError extends APIError {}

/** 502 / 503 / 504: the AI is temporarily unavailable (PROVIDER_UNAVAILABLE, AI_PROVIDER_ERROR). Retried automatically. */
export class ServiceUnavailableError extends APIError {}

type APIErrorClass = new (...args: ConstructorParameters<typeof APIError>) => APIError;

function errorClassFor(status: number, code: string): APIErrorClass {
  if (['API_KEY_MISSING', 'INVALID_API_KEY', 'UNAUTHORIZED'].includes(code) || status === 401) return AuthenticationError;
  if (code === 'INSUFFICIENT_CREDITS' || status === 402) return InsufficientCreditsError;
  if (['SPENDING_LIMIT_REACHED', 'USER_INACTIVE'].includes(code) || status === 403) return PermissionDeniedError;
  if (code === 'VALIDATION_ERROR' || status === 422) return ValidationError;
  if (code === 'RATE_LIMIT_EXCEEDED' || status === 429) return RateLimitError;
  if (['ENDPOINT_NOT_FOUND', 'NOT_FOUND'].includes(code) || status === 404) return NotFoundError;
  if ([502, 503, 504].includes(status)) return ServiceUnavailableError;
  if (status >= 500) return InternalServerError;
  return APIError;
}

function codeForStatus(status: number): string {
  switch (status) {
    case 401: return 'UNAUTHORIZED';
    case 402: return 'INSUFFICIENT_CREDITS';
    case 404: return 'ENDPOINT_NOT_FOUND';
    case 405: return 'METHOD_NOT_ALLOWED';
    case 422: return 'VALIDATION_ERROR';
    case 429: return 'RATE_LIMIT_EXCEEDED';
    case 503: return 'PROVIDER_UNAVAILABLE';
    default: return status >= 500 ? 'INTERNAL_SERVER_ERROR' : `HTTP_${status}`;
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
