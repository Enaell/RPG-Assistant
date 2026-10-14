import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLlmAgent } from './client';
import { AgentError } from './errors';
import type { AgentContext } from './types';

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    scene: 'exploration',
    mood: 'mystérieux',
    recentTranscript: [{ displayName: 'Alice', text: 'Bonjour', isGM: true }],
    trigger: 'polling',
    ...overrides,
  };
}

function chatResponse(content: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }),
    { status },
  );
}

const validPayload = {
  scene: 'exploration',
  mood: 'mystérieux',
  confidence: 0.8,
  actions: [{ type: 'none' }],
  trigger: 'polling',
  timestamp: '2026-01-01T10:00:00.000Z',
};

describe('createLlmAgent().decide', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sends a chat completion request and returns a validated AgentResponse', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse(validPayload));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const agent = createLlmAgent({ apiKey: 'key' });
    const result = await agent.decide(makeContext());

    expect(result).toEqual(validPayload);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions');
    const body = JSON.parse(init.body as string) as { messages: Array<{ role: string; }>; };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[1]?.role).toBe('user');
  });

  it('throws an AgentError when the LLM content is not valid JSON', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => chatResponse('not json at all')) as unknown as typeof fetch;

    const agent = createLlmAgent({ apiKey: 'key' });
    await expect(agent.decide(makeContext())).rejects.toThrow(/invalid JSON/);
  });

  it('throws an AgentError when the parsed JSON fails AgentResponse validation', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(chatResponse({ scene: 'x' })) as unknown as typeof fetch; // missing required fields

    const agent = createLlmAgent({ apiKey: 'key' });
    await expect(agent.decide(makeContext())).rejects.toThrow(/schema validation/);
  });

  it('rejects an action with an unrecognized type', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      chatResponse({ ...validPayload, actions: [{ type: 'explode' }] }),
    ) as unknown as typeof fetch;

    const agent = createLlmAgent({ apiKey: 'key' });
    await expect(agent.decide(makeContext())).rejects.toThrow(AgentError);
  });

  it('wraps network failures in an AgentError', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;

    const agent = createLlmAgent({ apiKey: 'key' });
    await expect(agent.decide(makeContext())).rejects.toThrow(/Network error/);
  });

  it('retries once on HTTP 500 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(chatResponse(validPayload));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const agent = createLlmAgent({ apiKey: 'key' });
    const result = await agent.decide(makeContext());

    expect(result.scene).toBe('exploration');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry on HTTP 401 (auth error)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const agent = createLlmAgent({ apiKey: 'bad-key' });
    await expect(agent.decide(makeContext())).rejects.toThrow(/HTTP 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts and throws an AgentError when the request exceeds the configured timeout, without retrying', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const agent = createLlmAgent({ apiKey: 'key', timeoutMs: 1_000 });
    const promise = agent.decide(makeContext());
    const assertion = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry after a timeout
  });
});
