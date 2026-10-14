import { AgentError } from './errors.js';
import { buildPrompt } from './prompt.js';
import { AgentResponseSchema, type AgentContext } from './types.js';
import type { AgentResponse } from '@rpg-assistant/shared-types';

const CHAT_COMPLETIONS_URL = 'https://api.mistral.ai/v1/chat/completions';

export const DEFAULT_LLM_MODEL = 'mistral-small-latest';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;

export type LlmAgentConfig = {
  /** Mistral API key (from MISTRAL_API_KEY env var). */
  apiKey: string;
  /** Defaults to `mistral-small-latest` — fast/cheap, sufficient for JSON action selection. */
  model?: string;
  /** Sampling temperature. Low by default for consistent, structured output. */
  temperature?: number;
  /** Aborts the request if the API hasn't responded within this many ms. */
  timeoutMs?: number;
};

export type LlmAgent = {
  /**
   * Build a prompt from the given context, call the LLM, and return a
   * validated AgentResponse.
   *
   * @throws {AgentError} on network failure, non-2xx response, invalid JSON,
   *   or a response that doesn't match the AgentResponse schema. There is no
   *   silent fallback — callers decide how to handle a failed decision (e.g.
   *   skip this polling tick, alert the GM, etc.).
   */
  decide(context: AgentContext): Promise<AgentResponse>;
};

export function createLlmAgent(config: LlmAgentConfig): LlmAgent {
  const model = config.model ?? DEFAULT_LLM_MODEL;
  const temperature = config.temperature ?? 0.2;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async decide(context: AgentContext): Promise<AgentResponse> {
      const { system, user } = buildPrompt(context);
      const start = Date.now();

      const raw = await callWithRetry(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let response: Response;
        try {
          response = await fetch(CHAT_COMPLETIONS_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model,
              temperature,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
            }),
            signal: controller.signal,
          });
        } catch (cause) {
          if (cause instanceof Error && cause.name === 'AbortError') {
            throw new AgentError(`Mistral API request timed out after ${timeoutMs}ms`);
          }
          throw new AgentError(
            `Network error reaching Mistral API: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '(unreadable body)');
          throw new AgentError(`Mistral API returned HTTP ${response.status}: ${body}`, response.status);
        }

        return response.json() as Promise<unknown>;
      });

      console.log(`[llm-agent] decide() completed in ${Date.now() - start}ms (model=${model})`);

      return parseAgentResponse(raw);
    },
  };
}

// ── Response parsing ─────────────────────────────────────────────────────────

function parseAgentResponse(raw: unknown): AgentResponse {
  const content = extractMessageContent(raw);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch (cause) {
    throw new AgentError(`LLM returned invalid JSON: ${content.slice(0, 200)}`, undefined, cause);
  }

  const result = AgentResponseSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new AgentError(
      `LLM response failed AgentResponse schema validation: ${result.error.message}`,
      undefined,
      result.error,
    );
  }

  return result.data;
}

function extractMessageContent(raw: unknown): string {
  const content = (raw as { choices?: Array<{ message?: { content?: unknown; }; }>; })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new AgentError('Mistral API response did not contain a chat message string');
  }
  return content;
}

// ── Retry helper ─────────────────────────────────────────────────────────────

/**
 * Retries network errors and 5xx/429 responses; does not retry 4xx (bad
 * request/auth) nor timeouts (a timeout already consumed the full budget —
 * retrying it would multiply latency for no benefit in an interactive agent).
 */
async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isTimeout = err instanceof AgentError && err.message.includes('timed out');
      const isRetryable =
        !isTimeout &&
        err instanceof AgentError &&
        (err.statusCode === undefined || err.statusCode === 429 || err.statusCode >= 500);
      if (!isRetryable || attempt >= MAX_RETRIES) throw err;

      const backoff = BASE_BACKOFF_MS * 2 ** attempt;
      console.warn(`[llm-agent] Retryable error, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
