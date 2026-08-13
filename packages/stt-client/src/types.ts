import { z } from 'zod';

/**
 * Schema for the Mistral POST /v1/audio/transcriptions response.
 * Validated at runtime to catch unexpected API shape changes.
 *
 * Full response reference:
 * https://docs.mistral.ai/studio-api/audio/speech_to_text/offline_transcription
 */
export const MistralTranscriptionResponseSchema = z.object({
  /** The full transcribed text. */
  text: z.string(),
  /** Model identifier echoed by the API. */
  model: z.string().optional(),
  /** Object type, e.g. "transcription". */
  object: z.string().optional(),
  /** Optional word or segment-level timestamps. */
  segments: z
    .array(
      z.object({
        text: z.string(),
        start: z.number().optional(),
        end: z.number().optional(),
        speaker: z.string().optional(),
      }),
    )
    .optional(),
});

export type MistralTranscriptionResponse = z.infer<
  typeof MistralTranscriptionResponseSchema
>;
