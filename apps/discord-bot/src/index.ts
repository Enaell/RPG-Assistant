import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// In a pnpm monorepo, .env lives at the workspace root.
// __dirname = apps/discord-bot/src → ../../../ = workspace root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

// Validate all required environment variables before any other import.
// process.exit(1) here is intentional — a misconfigured bot should not start.
//
// STT_MODEL is matched against this to reject realtime/WebSocket model names:
// this codebase only implements the batch POST /v1/audio/transcriptions
// endpoint, which those models are not intended for.
const REALTIME_MODEL_RE = /realtime/i;

const envSchema = z
  .object({
    DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
    DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
    DISCORD_GUILD_ID: z.string().min(1, 'DISCORD_GUILD_ID is required'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    // 'local' saves raw WAV to disk (dev only); 'stt' sends segments to the STT API.
    AUDIO_OUTPUT_MODE: z.enum(['local', 'stt']).default('local'),
    // Required when AUDIO_OUTPUT_MODE=stt, and for /session transcribe regardless of mode.
    MISTRAL_API_KEY: z.string().min(1).optional(),
    // Mirrors the default already used by @rpg-assistant/stt-client
    STT_MODEL: z.string().min(1).default('voxtral-mini-latest'),
    STT_LANGUAGE: z.string().optional(),
    RECORDINGS_DIR: z.string().min(1).default('./recordings'),
    DB_PATH: z.string().min(1).default('./data/rpg-assistant.db'),
  })
  .superRefine((val, ctx) => {
    if (val.AUDIO_OUTPUT_MODE === 'stt' && !val.MISTRAL_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MISTRAL_API_KEY'],
        message: 'MISTRAL_API_KEY is required when AUDIO_OUTPUT_MODE=stt',
      });
    }

    if (REALTIME_MODEL_RE.test(val.STT_MODEL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STT_MODEL'],
        message:
          `"${val.STT_MODEL}" is a realtime/WebSocket model and is not supported by the ` +
          'batch POST /v1/audio/transcriptions endpoint used by this bot. Use ' +
          '"voxtral-mini-latest" instead.',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid or missing environment variables:');
  for (const [key, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${messages?.join(', ') ?? 'unknown error'}`);
  }
  process.exit(1);
}

export type Env = z.infer<typeof envSchema>;
export const env: Env = parsed.data;

// Deferred import so env is guaranteed valid before any module initialises
import('./bot')
  .then(({ startBot }) => startBot(env))
  .catch((err: unknown) => {
    console.error('Fatal error starting bot:', err);
    process.exit(1);
  });
