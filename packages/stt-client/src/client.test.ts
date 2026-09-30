import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSttClient } from './client';
import { SttError } from './errors';
import { MistralTranscriptionResponseSchema } from './types';
import type { AudioSegment } from '@rpg-assistant/shared-types';

function makeSegment(overrides: Partial<AudioSegment> = {}): AudioSegment {
  return {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    userId: 'user-1',
    username: 'alice',
    displayName: 'Alice',
    isGM: true,
    startTimestamp: new Date('2026-01-01T10:00:00.000Z'),
    endTimestamp: new Date('2026-01-01T10:00:03.000Z'),
    durationMs: 3000,
    wavBuffer: Buffer.from([1, 2, 3]),
    ...overrides,
  };
}

describe('createSttClient().transcribe', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends a multipart request and maps a valid response to a TranscriptLine', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: '  Bonjour aventuriers  ' }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createSttClient({ apiKey: 'test-key' });
    const segment = makeSegment();
    const line = await client.transcribe(segment);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mistral.ai/v1/audio/transcriptions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');

    expect(line.text).toBe('Bonjour aventuriers'); // trimmed
    expect(line.sessionId).toBe(segment.sessionId);
    expect(line.speakerId).toBe(segment.userId);
    expect(line.isGM).toBe(true);
    expect(line.startTimestamp).toBe(segment.startTimestamp.toISOString());
  });

  it('wraps network failures in an SttError without a status code', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;

    const client = createSttClient({ apiKey: 'test-key' });
    await expect(client.transcribe(makeSegment())).rejects.toMatchObject({
      name: 'SttError',
      statusCode: undefined,
    });
  });

  it('raises an SttError with statusCode and retryAfterMs on HTTP 429', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Too Many Requests', {
        status: 429,
        headers: { 'retry-after': '5' },
      }),
    ) as unknown as typeof fetch;

    const client = createSttClient({ apiKey: 'test-key' });
    const err: SttError = await client.transcribe(makeSegment()).catch((e) => e);

    expect(err).toBeInstanceOf(SttError);
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterMs).toBe(5_000);
  });

  it('raises an SttError with no retryAfterMs when the header is absent', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Server error', { status: 500 }),
    ) as unknown as typeof fetch;

    const client = createSttClient({ apiKey: 'test-key' });
    const err: SttError = await client.transcribe(makeSegment()).catch((e) => e);

    expect(err.statusCode).toBe(500);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('rejects with an SttError when the response body does not match the expected shape', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ unexpected: 'shape' }), { status: 200 }),
    ) as unknown as typeof fetch;

    const client = createSttClient({ apiKey: 'test-key' });
    await expect(client.transcribe(makeSegment())).rejects.toThrow(SttError);
  });
});

describe('MistralTranscriptionResponseSchema', () => {
  it('accepts a minimal valid response', () => {
    const result = MistralTranscriptionResponseSchema.safeParse({ text: 'hello' });
    expect(result.success).toBe(true);
  });

  it('accepts an enriched response with model/object/segments', () => {
    const result = MistralTranscriptionResponseSchema.safeParse({
      text: 'hello',
      model: 'voxtral-mini-latest',
      object: 'transcription',
      segments: [{ text: 'hello', start: 0, end: 1.2, speaker: 'A' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a response missing the required text field', () => {
    const result = MistralTranscriptionResponseSchema.safeParse({ model: 'voxtral-mini-latest' });
    expect(result.success).toBe(false);
  });

  it('rejects a response where text is not a string', () => {
    const result = MistralTranscriptionResponseSchema.safeParse({ text: 42 });
    expect(result.success).toBe(false);
  });
});
