import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AudioSegment } from '@rpg-assistant/shared-types';
import { createSttClient, SttError } from '@rpg-assistant/stt-client';
import type { SttClient } from '@rpg-assistant/stt-client';
import { transcriptRepository } from './database.js';

// Read from process.env — values are guaranteed valid by the time any session
// starts, because index.ts validates them with Zod before loading the bot.
const OUTPUT_MODE = (process.env['AUDIO_OUTPUT_MODE'] ?? 'local') as 'local' | 'stt';

// Resolved relative to process.cwd() — this differs by launch method:
//   `pnpm dev:bot` sets cwd to apps/discord-bot, Docker sets cwd to /app
//   (bind-mounted to the repo-root ./recordings). Sessions recorded under one
//   method are NOT visible from the other — see README "Chemins de stockage".
const RECORDINGS_DIR = resolve(process.cwd(), process.env['RECORDINGS_DIR'] ?? './recordings');
console.log(`📁 Répertoire d'enregistrements (mode ${OUTPUT_MODE}) : ${RECORDINGS_DIR}`);

// ── STT client (lazy singleton) ───────────────────────────────────────────────
// Initialised on first use so the error surface is clear if config is missing.
let _sttClient: SttClient | null = null;

function getSttClient(): SttClient {
  if (_sttClient) return _sttClient;

  const apiKey = process.env['MISTRAL_API_KEY'];
  if (!apiKey) {
    throw new SttError('MISTRAL_API_KEY is not set — cannot create STT client');
  }

  _sttClient = createSttClient({
    apiKey,
    model: process.env['STT_MODEL'],       // defaults to voxtral-mini-latest in the package
    language: process.env['STT_LANGUAGE'], // e.g. 'fr' — leave undefined for auto-detect
  });
  return _sttClient;
}

// ── Public dispatcher ─────────────────────────────────────────

/**
 * Route a completed audio segment according to AUDIO_OUTPUT_MODE:
 *
 *  - 'local' → write the WAV buffer to RECORDINGS_DIR/<sessionId>/ (dev only)
 *  - 'stt'   → send to Mistral Voxtral API via packages/stt-client
 *
 * ⚠️  AUDIO_OUTPUT_MODE=local persists raw audio to disk and must NEVER be
 *     used in production. See ADR-002 and the project privacy requirements.
 */
export async function dispatchAudioSegment(segment: AudioSegment): Promise<void> {
  if (OUTPUT_MODE === 'local') {
    await saveWavLocally(segment);
  } else {
    await sendToStt(segment);
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

// ── STT transcription (Phase 1+) ─────────────────────────────

/**
 * Send a WAV buffer to the Mistral Voxtral API via stt-client and log the
 * resulting TranscriptLine.  In Phase 2 the returned line will be forwarded
 * to the context-manager instead of just logged.
 */
async function sendToStt(segment: AudioSegment): Promise<void> {
  const durationS = (segment.durationMs / 1000).toFixed(2);
  const role = segment.isGM ? ' 👑 MJ' : '';

  try {
    const client = getSttClient();
    const line = await client.transcribe(segment);

    if (!line.text) {
      console.log(`🔇 [${segment.displayName}${role}] (silence ou transcription vide, ${durationS}s)`);
      return;
    }

    console.log(`📝 [${line.displayName}${role}]: ${line.text}`);

    // Persist the transcript line — synchronous, never throws outside the try block
    try {
      transcriptRepository.save(line);
    } catch (dbErr) {
      console.error('❌ [DB] Impossible de sauvegarder la ligne de transcript :', dbErr);
    }
  } catch (err) {
    if (err instanceof SttError) {
      console.error(
        `❌ [STT] Erreur pour [${segment.displayName}${role}] — ${err.message}`,
        err.statusCode !== undefined ? `(HTTP ${err.statusCode})` : '',
      );
    } else {
      console.error(`❌ [STT] Erreur inattendue pour [${segment.displayName}]:`, err);
    }
  }
}

