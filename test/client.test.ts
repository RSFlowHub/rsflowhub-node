import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RSFlowHubDefault, { RSFlowHub, RSFlowHubError, VERSION } from '../src/index.js';
import { kebab } from '../src/operations.js';
import { operations } from '../src/generated/operations.js';
import { json, mockClient, ok } from './helpers.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('calls', () => {
  it('posts JSON with the API key and returns data and result', async () => {
    const m = mockClient();
    m.queue(ok({ result: { sentiment: 'positive', aspects: [{ name: 'billing' }] } }, { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' }));

    const res = await m.client.ai.sentimentAnalysis({ text: 'Loved it' });

    expect(m.last().method).toBe('POST');
    expect(m.last().url).toBe('https://api.test/api/v1/ai/sentiment-analysis');
    expect(m.last().headers.get('X-API-Key')).toBe('rfh_test1234_secret');
    expect(m.last().headers.get('Content-Type')).toBe('application/json');
    expect(m.last().headers.get('X-RSFlowHub-Client')).toBe(`rsflowhub-node/${VERSION}`);
    expect(m.lastJson()).toEqual({ text: 'Loved it' });

    expect(res.result.sentiment).toBe('positive');
    expect(res.get('result.aspects.0.name')).toBe('billing');
    expect(res.get('result.missing', 'none')).toBe('none');
    expect(res.requestId).toBe('req_123');
    expect(res.meta.version).toBe('v1');
    expect(res.rateLimit).toEqual({ limit: 60, remaining: 59, reset: null });
  });

  it('works for AI endpoints released after this SDK, without a spec lookup', async () => {
    const m = mockClient();
    m.queue(ok({ result: {} }), ok({ result: {} }));

    await m.client.ai.speechToTextV2!({ audio_url: 'https://example.com/a.mp3' });
    await m.client.call('ai', 'speechToTextV2', { audio_url: 'x' });

    expect(m.last().url).toBe('https://api.test/api/v1/ai/speech-to-text-v2');
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]!.url).toBe('https://api.test/api/v1/ai/speech-to-text-v2');
  });

  it('binds path ids in order or by name', async () => {
    const m = mockClient();
    m.queue(ok(), ok(), ok());

    await m.client.knowledgeBases.ask(12, { question: 'Refunds?' });
    expect(m.last().url).toBe('https://api.test/api/v1/knowledge-bases/12/ask');
    expect(m.lastJson()).toEqual({ question: 'Refunds?' });

    await (m.client.knowledgeBases.ask as any)({ id: 7, question: 'Shipping?' });
    expect(m.last().url).toBe('https://api.test/api/v1/knowledge-bases/7/ask');
    expect(m.lastJson()).toEqual({ question: 'Shipping?' });

    await m.client.chatbots.getConversation(3, 'conv/a b');
    expect(m.last().method).toBe('GET');
    expect(m.last().url).toBe('https://api.test/api/v1/chatbots/3/conversations/conv%2Fa%20b');
  });

  it('sends GET params as the query string and options separately', async () => {
    const m = mockClient();
    m.queue(ok({ items: [] }), ok({ id: 5 }));

    await m.client.account.usage({ page: 2, filters: { endpoint: 'chat' } } as any);
    expect(m.last().url).toBe('https://api.test/api/v1/account/usage?page=2&filters%5Bendpoint%5D=chat');
    expect(m.last().body).toBeUndefined();

    const controller = new AbortController();
    await m.client.knowledgeBases.get(5, { signal: controller.signal, headers: { 'X-Trace': 't1' } });
    expect(m.last().url).toBe('https://api.test/api/v1/knowledge-bases/5');
    expect(m.last().headers.get('X-Trace')).toBe('t1');
  });

  it('rejects a missing path id clearly', async () => {
    const m = mockClient();
    await expect((m.client.knowledgeBases.ask as any)({ question: 'x' })).rejects.toThrow('needs the "id" path parameter');
  });

  it('looks unknown non-AI methods up in the live spec once', async () => {
    const m = mockClient();
    m.queue(
      json(200, {
        openapi: '3.0.3',
        paths: {
          '/knowledge-bases/{id}/reindex': { post: { 'x-rsflowhub-sdk': { resource: 'knowledgeBases', method: 'reindex' } } },
          '/webhooks': { get: { 'x-rsflowhub-sdk': { resource: 'webhooks', method: 'list' } } },
        },
      }),
      ok({ queued: true }),
      ok({ webhooks: [] }),
    );

    const res = await m.client.call('knowledgeBases', 'reindex', 5);
    await m.client.resource('webhooks').list!();

    expect(res.data.queued).toBe(true);
    expect(m.calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/api/v1/openapi.json',
      '/api/v1/knowledge-bases/5/reindex',
      '/api/v1/webhooks',
    ]);
  });

  it('explains the alternatives for an unknown method without live spec', async () => {
    const m = mockClient({ liveSpec: false });
    await expect(m.client.call('knowledgeBases', 'doesNotExist', 1)).rejects.toThrow('client.request()');
  });

  it('reaches any route with request()', async () => {
    const m = mockClient();
    m.queue(ok({ result: { translated: 'Bonjour' } }));

    const res = await m.client.request('POST', '/ai/translation', { text: 'Hello', target_language: 'French' });

    expect(res.result.translated).toBe('Bonjour');
  });

  it('uploads Blobs as multipart with bracketed nested fields', async () => {
    const m = mockClient();
    m.queue(ok({ document: { id: 9 } }));

    // Node 18 has Blob but no global File (added in Node 20).
    const hasFile = typeof File !== 'undefined';
    const file = hasFile
      ? new File(['Refunds within 30 days.'], 'refunds.txt', { type: 'text/plain' })
      : new Blob(['Refunds within 30 days.'], { type: 'text/plain' });

    await m.client.knowledgeBases.createDocument(4, { file, metadata: { source: 'faq' } });

    const form = m.last().body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(m.last().headers.get('Content-Type')).toBeNull(); // fetch sets the boundary
    const sent = form.get('file') as Blob & { name?: string };
    expect(sent.name).toBe(hasFile ? 'refunds.txt' : 'file');
    expect(await sent.text()).toBe('Refunds within 30 days.');
    expect(form.get('metadata[source]')).toBe('faq');
  });

  it('is not a thenable (await client.ai is safe)', async () => {
    const m = mockClient();
    expect((m.client.ai as any).then).toBeUndefined();
    expect(m.client.ai).toBe(m.client.ai);
  });
});

describe('setup', () => {
  it('reads the key and base URL from the environment', () => {
    vi.stubEnv('RSFLOWHUB_API_KEY', 'rfh_fromenv_x');
    vi.stubEnv('RSFLOWHUB_BASE_URL', 'https://staging.test/api/v1/');
    const client = new RSFlowHub();
    expect(client.baseURL).toBe('https://staging.test/api/v1');
  });

  it('fails fast without an API key', () => {
    vi.stubEnv('RSFLOWHUB_API_KEY', '');
    expect(() => new RSFlowHub()).toThrow(RSFlowHubError);
  });

  it('refuses to run in a browser unless allowed', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(() => new RSFlowHub({ apiKey: 'rfh_x' })).toThrow('anyone can read your API key');
    expect(() => new RSFlowHub({ apiKey: 'rfh_x', dangerouslyAllowBrowser: true })).not.toThrow();
  });

  it('exports the client as default too', () => {
    expect(RSFlowHubDefault).toBe(RSFlowHub);
  });

  it('keeps VERSION in step with package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });

  it('converts camelCase to kebab-case', () => {
    expect(kebab('sentimentAnalysis')).toBe('sentiment-analysis');
    expect(kebab('piiRedaction')).toBe('pii-redaction');
    expect(kebab('chat')).toBe('chat');
    expect(kebab('textToSpeech2')).toBe('text-to-speech2');
  });

  it('ships a bundled map for the known resources', () => {
    expect(operations.ai!.sentimentAnalysis).toEqual(['POST', '/ai/sentiment-analysis']);
    expect(operations.knowledgeBases!.ask).toEqual(['POST', '/knowledge-bases/{id}/ask']);
  });
});
