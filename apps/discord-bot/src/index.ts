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
  // 'stt'   → forward to the STT hook (packages/stt-client, Phase 1+)
  AUDIO_OUTPUT_MODE: z.enum(['local', 'stt']).default('local'),
  RECORDINGS_DIR: z.string().default('./recordings'),
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
