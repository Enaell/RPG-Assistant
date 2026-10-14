import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createApp } from './server.js';
import { log } from './logger.js';

// In the pnpm monorepo, .env lives at the workspace root.
// __dirname = apps/orchestrator/src → ../../../ = workspace root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ORCHESTRATOR_PORT: z.coerce.number().int().positive().default(3001),
  // Actions of the same type+payload within this window are treated as
  // duplicates and skipped (protects against polling re-triggering the same
  // music/image/tip repeatedly).
  DEDUP_WINDOW_MS: z.coerce.number().int().nonnegative().default(4_000),
  // Same file discord-bot writes to — enables GET /transcript/recent. Optional:
  // omit to run the orchestrator without transcript access (e.g. in tests).
  DB_PATH: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid or missing environment variables:');
  for (const [key, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${messages?.join(', ') ?? 'unknown error'}`);
  }
  process.exit(1);
}

const env = parsed.data;
const dbPath = env.DB_PATH ? resolve(process.cwd(), env.DB_PATH) : undefined;

const app = createApp({ dedupWindowMs: env.DEDUP_WINDOW_MS, dbPath });

// Bound to 127.0.0.1 only — this API must never be exposed publicly (same
// privacy/security requirement as the rest of the stack).
app.listen(env.ORCHESTRATOR_PORT, '127.0.0.1', () => {
  log('orchestrator.started', {
    port: env.ORCHESTRATOR_PORT,
    dedupWindowMs: env.DEDUP_WINDOW_MS,
    transcriptAccess: Boolean(dbPath),
  });
});
