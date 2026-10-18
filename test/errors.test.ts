import { describe, expect, it } from 'vitest';
import {
  AbortError,
  APIError,
  AuthenticationError,
  ConnectionError,
  InsufficientCreditsError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  RSFlowHubError,
  ServiceUnavailableError,
  ValidationError,
} from '../src/index.js';
import { apiError, mockClient, ok } from './helpers.js';

async function caught(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('errors', () => {
  it('validation errors expose code, message, request id and fields', async () => {
    const m = mockClient();
    m.queue(apiError(422, 'VALIDATION_ERROR', 'The given data was invalid.', { text: ['The text field is required.'] }));

    const e = await caught(m.client.ai.sentimentAnalysis({} as any));

    expect(e).toBeInstanceOf(ValidationError);
    expect(e).toBeInstanceOf(APIError);
    expect(e).toBeInstanceOf(RSFlowHubError);
    expect(e.name).toBe('ValidationError');
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.status).toBe(422);
    expect(e.message).toBe('The given data was invalid.');
    expect(e.requestId).toBe('req_err');
    expect(e.errors).toEqual({ text: ['The text field is required.'] });
  });

  it('insufficient credits exposes required and available', async () => {
    const m = mockClient();
    m.queue(apiError(402, 'INSUFFICIENT_CREDITS', 'Not enough credits.', { required_credits: 3, available_credits: 1 }));

    const e = await caught(m.client.ai.reviewSummary({ reviews: ['ok'] }));

    expect(e).toBeInstanceOf(InsufficientCreditsError);
    expect(e.requiredCredits).toBe(3);
    expect(e.availableCredits).toBe(1);
  });

  it.each([
    [401, 'INVALID_API_KEY', AuthenticationError],
    [401, 'API_KEY_MISSING', AuthenticationError],
    [403, 'SPENDING_LIMIT_REACHED', PermissionDeniedError],
    [403, 'USER_INACTIVE', PermissionDeniedError],
    [404, 'ENDPOINT_NOT_FOUND', NotFoundError],
    [500, 'INTERNAL_SERVER_ERROR', InternalServerError],
    [502, 'AI_PROVIDER_ERROR', ServiceUnavailableError],
    [405, 'METHOD_NOT_ALLOWED', APIError],
  ] as const)('%i %s maps to %o', async (status, code, Ctor) => {
    const m = mockClient({ maxRetries: 0 });
    m.queue(apiError(status, code, 'Nope'));

    const e = await caught(m.client.ai.chat({ message: 'hi' }));

    expect(e.constructor).toBe(Ctor);
    expect(e.code).toBe(code);
  });

  it('non-JSON error pages still map by status', async () => {
    const m = mockClient({ maxRetries: 0 });
    m.queue(new Response('<html>Bad gateway</html>', { status: 503 }));

    const e = await caught(m.client.ai.chat({ message: 'hi' }));

    expect(e).toBeInstanceOf(ServiceUnavailableError);
    expect(e.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('non-JSON success is an SDK error', async () => {
    const m = mockClient();
    m.queue(new Response('<html>maintenance</html>', { status: 200 }));

    await expect(m.client.ai.chat({ message: 'hi' })).rejects.toBeInstanceOf(RSFlowHubError);
  });
});

describe('retries', () => {
  it('retries 429 and 503, honouring Retry-After', async () => {
    const m = mockClient();
    m.queue(
      apiError(429, 'RATE_LIMIT_EXCEEDED', 'Slow down', {}, { 'Retry-After': '2' }),
      apiError(503, 'PROVIDER_UNAVAILABLE', 'Busy'),
      ok({ result: { reply: 'Hello' } }),
    );

    const res = await m.client.ai.chat({ message: 'hi' });

    expect(res.result.reply).toBe('Hello');
    expect(m.calls).toHaveLength(3);
    expect(m.sleeps[0]).toBe(2000);
    expect(m.sleeps[1]).toBeGreaterThanOrEqual(1000);
  });

  it('gives up after maxRetries and exposes retryAfter', async () => {
    const m = mockClient({ maxRetries: 1 });
    m.queue(
      apiError(429, 'RATE_LIMIT_EXCEEDED', 'Slow down', {}, { 'Retry-After': '7' }),
      apiError(429, 'RATE_LIMIT_EXCEEDED', 'Slow down', {}, { 'Retry-After': '7' }),
    );

    const e = await caught(m.client.ai.chat({ message: 'hi' }));

    expect(e).toBeInstanceOf(RateLimitError);
    expect(e.retryAfter).toBe(7);
    expect(m.calls).toHaveLength(2);
  });

  it('per-call maxRetries overrides the client setting', async () => {
    const m = mockClient();
    m.queue(apiError(503, 'PROVIDER_UNAVAILABLE', 'Busy'));

    await caught(m.client.ai.chat({ message: 'hi' }, { maxRetries: 0 }));

    expect(m.calls).toHaveLength(1);
  });

  it('does not retry validation or server errors', async () => {
    const m = mockClient();
    m.queue(apiError(500, 'INTERNAL_SERVER_ERROR', 'Oops'));

    await caught(m.client.ai.chat({ message: 'hi' }));

    expect(m.calls).toHaveLength(1);
    expect(m.sleeps).toEqual([]);
  });

  it('retries network failures, then raises ConnectionError', async () => {
    const m = mockClient({ maxRetries: 1 });
    m.queue(new TypeError('fetch failed'), new TypeError('fetch failed'));

    await expect(m.client.ai.chat({ message: 'hi' })).rejects.toBeInstanceOf(ConnectionError);
    expect(m.sleeps).toHaveLength(1);
  });

  it('an aborted signal stops at once with AbortError', async () => {
    const m = mockClient();
    const controller = new AbortController();
    controller.abort();

    await expect(m.client.ai.chat({ message: 'hi' }, { signal: controller.signal })).rejects.toBeInstanceOf(AbortError);
    expect(m.calls).toHaveLength(0);
  });

  it('times out with ConnectionError', async () => {
    const hanging = ((_: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as typeof fetch;
    const { RSFlowHub } = await import('../src/index.js');
    const client = new RSFlowHub({ apiKey: 'rfh_x', baseURL: 'https://api.test/api/v1', fetch: hanging, timeout: 20, maxRetries: 0 });

    await expect(client.ai.chat({ message: 'hi' })).rejects.toThrow('timed out after 20 ms');
  });
});
