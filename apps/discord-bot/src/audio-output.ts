import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AudioSegment } from '@rpg-assistant/shared-types';

// Read from process.env — values are guaranteed valid by the time any session
// starts, because index.ts validates them with Zod before loading the bot.
const OUTPUT_MODE = (process.env['AUDIO_OUTPUT_MODE'] ?? 'local') as 'local' | 'stt';

// Resolve relative to cwd (workspace root when launched via pnpm)
const RECORDINGS_DIR = resolve(process.cwd(), process.env['RECORDINGS_DIR'] ?? './recordings');

// ── Public dispatcher ─────────────────────────────────────────

/**
 * Route a completed audio segment according to AUDIO_OUTPUT_MODE:
 *
 *  - 'local' → write the WAV buffer to RECORDINGS_DIR/<sessionId>/ (dev only)
 *  - 'stt'   → forward to the STT hook stub (packages/stt-client, Phase 1+)
 *
 * ⚠️  AUDIO_OUTPUT_MODE=local persists raw audio to disk and must NEVER be
 *     used in production. See ADR-002 and the project privacy requirements.
 */
export async function dispatchAudioSegment(segment: AudioSegment): Promise<void> {
  if (OUTPUT_MODE === 'local') {
    await saveWavLocally(segment);
  } else {
    logSttStub(segment);
  }
}

// ── Local save (development only) ────────────────────────────

async function saveWavLocally(segment: AudioSegment): Promise<void> {
  const sessionDir = join(RECORDINGS_DIR, segment.sessionId);

  // Create the session sub-directory if it doesn't exist yet
  await mkdir(sessionDir, { recursive: true });

  // Filename: ISO timestamp (colons replaced) + display name, e.g.
  //   2026-06-28T14-23-05_Jean-Dupont.wav
  const ts = segment.startTimestamp.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeName = segment.displayName.replace(/[^\w-]/g, '_');
  const filename = `${ts}_${safeName}.wav`;
  const filePath = join(sessionDir, filename);

  await writeFile(filePath, segment.wavBuffer);

  const sizekB = (segment.wavBuffer.byteLength / 1024).toFixed(1);
  const durationS = (segment.durationMs / 1000).toFixed(2);
  const role = segment.isGM ? ' 👑 MJ' : '';
  console.log(`💾 [${segment.displayName}${role}] ${filename} — ${durationS}s, ${sizekB} KB`);
}

// ── STT hook stub (Phase 1+) ──────────────────────────────────

/**
 * Placeholder for the future STT integration.
 * Replace the body of this function with a call to sttClient.transcribe()
 * once packages/stt-client is implemented.
 *
 * Example (Phase 1):
 *   import { sttClient } from '@rpg-assistant/stt-client';
 *   const line = await sttClient.transcribe(segment);
 *   console.log(`📝 [${line.displayName}]: ${line.text}`);
 */
function logSttStub(segment: AudioSegment): void {
  const durationS = (segment.durationMs / 1000).toFixed(2);
  const sizekB = (segment.wavBuffer.byteLength / 1024).toFixed(1);
  const role = segment.isGM ? ' 👑 MJ' : '';
  console.log(
    `🔌 [STT hook] [${segment.displayName}${role}] ${durationS}s, ${sizekB} KB` +
    ' — en attente d\'intégration packages/stt-client',
  );
}
