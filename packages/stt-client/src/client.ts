import { randomUUID } from 'node:crypto';
import type { AudioSegment, TranscriptLine } from '@rpg-assistant/shared-types';
import { SttError } from './errors.js';
import { MistralTranscriptionResponseSchema } from './types.js';

const TRANSCRIPTION_URL = 'https://api.mistral.ai/v1/audio/transcriptions';

/**
 * Model choices for the Mistral audio transcription HTTP endpoint.
 *
 * - `voxtral-mini-latest`  → Voxtral Mini Transcribe (offline batch, recommended for
 *                            buffered WAV files).  Maps to voxtral-mini-transcribe-2602.
 * - `voxtral-mini-transcribe-realtime-2602` / `voxtral-mini-transcribe-realtime-latest`
 *                          → Optimised for WebSocket streaming (Phase 2).  May also
 *                            be used on the HTTP endpoint; set STT_MODEL in .env to
 *                            try it.
 *
 * Configure via the `STT_MODEL` environment variable.
 */
export const DEFAULT_STT_MODEL = 'voxtral-mini-latest';

export type SttConfig = {
  /** Mistral API key (from MISTRAL_API_KEY env var). */
  apiKey: string;
  /**
   * Model to use for transcription.
   * Defaults to `voxtral-mini-latest` (offline batch transcription).
   */
  model?: string;
  /**
   * BCP-47 / ISO 639-1 language code, e.g. `fr`, `en`.
   * When provided, skips auto-detection and improves accuracy.
   * Note: incompatible with `timestamp_granularities` per Mistral docs.
   */
  language?: string;
};

export type SttClient = {
  /**
   * Transcribe a completed audio segment using the Mistral API.
   * The WAV buffer is sent as multipart form data and discarded immediately
   * after the request (never stored by this function).
   *
   * @throws {SttError} on network failure or non-2xx API response.
   */
  transcribe(segment: AudioSegment): Promise<TranscriptLine>;
};

/**
 * Build a configured STT client that sends WAV buffers to the Mistral
 * `POST /v1/audio/transcriptions` endpoint.
 *
 * @example
 * ```ts
 * const stt = createSttClient({ apiKey: process.env.MISTRAL_API_KEY! });
 * const line = await stt.transcribe(segment);
 * console.log(line.text);
 * ```
 */
export function createSttClient(config: SttConfig): SttClient {
  const model = config.model ?? DEFAULT_STT_MODEL;

  return {
    async transcribe(segment: AudioSegment): Promise<TranscriptLine> {
      // Build multipart/form-data payload.
      // Node 20+ exposes FormData and Blob globally — no extra dependencies needed.
      const form = new FormData();
      const blob = new Blob([segment.wavBuffer], { type: 'audio/wav' });
      form.append('file', blob, `${segment.segmentId}.wav`);
      form.append('model', model);
      if (config.language) {
        form.append('language', config.language);
      }

      let response: Response;
      try {
        response = await fetch(TRANSCRIPTION_URL, {
          method: 'POST',
          headers: {
            // Do NOT set Content-Type here — the browser/Node will set it
            // automatically with the correct multipart boundary.
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: form,
        });
      } catch (cause) {
        throw new SttError(
          `Network error reaching Mistral STT API: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '(unreadable body)');
        throw new SttError(
          `Mistral STT API returned HTTP ${response.status}: ${body}`,
          response.status,
        );
      }

      const raw: unknown = await response.json();
      const result = MistralTranscriptionResponseSchema.safeParse(raw);
      if (!result.success) {
        throw new SttError(
          `Unexpected Mistral STT response shape: ${result.error.message}`,
        );
      }

      const text = result.data.text.trim();

      return {
        id: randomUUID(),
        sessionId: segment.sessionId,
        speakerId: segment.userId,
        speakerName: segment.username,
        displayName: segment.displayName,
        text,
        startTimestamp: segment.startTimestamp.toISOString(),
        endTimestamp: segment.endTimestamp.toISOString(),
        isGM: segment.isGM,
      };
    },
  };
}
