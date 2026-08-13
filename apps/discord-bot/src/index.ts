import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// In a pnpm monorepo, .env lives at the workspace root.
// __dirname = apps/discord-bot/src → ../../../ = workspace root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

// Validate all required environment variables before any other import.
// process.exit(1) here is intentional — a misconfigured bot should not start.
const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_GUILD_ID: z.string().min(1, 'DISCORD_GUILD_ID is required'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // ── Audio output ──────────────────────────────────────────
  // 'local' → save WAV files to RECORDINGS_DIR (dev/debug only)
  // 'stt'   → forward to packages/stt-client → Mistral Voxtral API
  AUDIO_OUTPUT_MODE: z.enum(['local', 'stt']).default('local'),
  RECORDINGS_DIR: z.string().default('./recordings'),
  // ── STT — Mistral / Voxtral API ───────────────────────────
  // Required only when AUDIO_OUTPUT_MODE=stt
  MISTRAL_API_KEY: z.string().min(1).optional(),
  // Model for the HTTP transcriptions endpoint.
  // voxtral-mini-latest          = offline batch (default, recommended for WAV files)
  // voxtral-mini-transcribe-realtime-2602 = realtime optimised (Phase 2 WebSocket)
  STT_MODEL: z.string().default('voxtral-mini-latest'),
  // BCP-47 language hint, e.g. 'fr', 'en'. Leave empty for auto-detection.
  STT_LANGUAGE: z.string().default('fr'),
  // ── Database ───────────────────────────────────────────────
  // Path to the SQLite file (relative to cwd or absolute).
  DB_PATH: z.string().default('./data/rpg-assistant.db'),
}).refine(
  (d) => d.AUDIO_OUTPUT_MODE !== 'stt' || (d.MISTRAL_API_KEY !== undefined && d.MISTRAL_API_KEY.length > 0),
  { message: 'MISTRAL_API_KEY is required when AUDIO_OUTPUT_MODE=stt', path: ['MISTRAL_API_KEY'] },
);

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
