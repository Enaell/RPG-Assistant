import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AudioSegment, TranscriptLine } from '@rpg-assistant/shared-types';
import { createSttClient, SttError } from '@rpg-assistant/stt-client';
import type { SttClient } from '@rpg-assistant/stt-client';
import type { TranscriptRepository } from '@rpg-assistant/db';

// Filename format written by audio-output.ts in 'local' mode:
//   2026-06-28T14-23-05_DisplayName.wav
// Colons in the timestamp are replaced with dashes to stay filesystem-safe.
const WAV_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})_(.+)\.wav$/;

// Sessions can have hundreds of short utterances — spacing requests out and
// backing off on 429s avoids hitting the Mistral API rate limit.
const REQUEST_DELAY_MS = 300;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

export type TranscriberOptions = {
  mistralApiKey: string;
  sttModel?: string;
  sttLanguage?: string;
  /** Called after each file is processed (0-indexed). */
  onProgress?: (done: number, total: number, filename: string) => void;
};

export type TranscriberResult = {
  sessionId: string;
  processed: number;
  skipped: number;
  lines: TranscriptLine[];
  /** Path to the plain-text transcript export, if any line was transcribed. */
  transcriptPath?: string;
};

/**
 * Transcribe all WAV files from a 'local' recording session in chronological
 * order and persist each resulting TranscriptLine to the database.
 *
 * Files are sorted lexicographically — the ISO-prefix filename format
 * guarantees this equals chronological order.
 */
export async function transcribeRecordingSession(
  sessionId: string,
  recordingsDir: string,
  repo: TranscriptRepository,
  opts: TranscriberOptions,
): Promise<TranscriberResult> {
  const sessionDir = join(recordingsDir, sessionId);

  let files: string[];
  try {
    const entries = await readdir(sessionDir);
    files = entries.filter((f) => WAV_RE.test(f)).sort();
  } catch {
    throw new Error(`Répertoire de session introuvable : ${sessionDir}`);
  }

  if (files.length === 0) {
    throw new Error(`Aucun fichier WAV trouvé dans ${sessionDir}`);
  }

  const client = createSttClient({
    apiKey: opts.mistralApiKey,
    model: opts.sttModel,
    language: opts.sttLanguage,
  });

  const lines: TranscriptLine[] = [];
  let skipped = 0;

  for (let i = 0; i < files.length; i++) {
    const filename = files[i]!;
    opts.onProgress?.(i, files.length, filename);

    const match = WAV_RE.exec(filename);
    if (!match) { skipped++; continue; }

    const [, rawTs, sanitizedName] = match;
    // Restore ISO 8601 from the dashes-for-colons encoding (time part only)
    const startIso = rawTs!.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3') + '.000Z';
    const displayName = sanitizedName!.replace(/_/g, ' ');

    const wavBuffer = Buffer.from(await readFile(join(sessionDir, filename)));
    const durationMs = wavDurationMs(wavBuffer);
    const startDate = new Date(startIso);
    const endDate = new Date(startDate.getTime() + durationMs);

    const segment: AudioSegment = {
      segmentId: randomUUID(),
      sessionId,
      // No Discord Snowflake available post-hoc; use a synthetic identifier
      userId: `recording:${displayName}`,
      username: displayName,
      displayName,
      // isGM cannot be determined from filename alone after the fact
      isGM: false,
      startTimestamp: startDate,
      endTimestamp: endDate,
      durationMs,
      wavBuffer,
    };

    try {
      const line = await transcribeWithRetry(client, segment, filename);
      if (!line.text) {
        skipped++;
        continue;
      }
      try {
        repo.save(line);
      } catch (dbErr) {
        console.error(`[transcribe] DB save failed for ${filename}:`, dbErr);
      }
      lines.push(line);
    } catch (err) {
      const msg = err instanceof SttError ? err.message : String(err);
      console.error(`[transcribe] STT failed for ${filename}: ${msg}`);
      skipped++;
    }

    // Small throttle between requests so we don't hammer the API and trigger
    // 429s in the first place, especially on sessions with hundreds of files.
    if (i < files.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  opts.onProgress?.(files.length, files.length, '');

  // Export a plain-text transcript next to the WAVs so it can be read/shared
  // without querying SQLite directly.
  let transcriptPath: string | undefined;
  if (lines.length > 0) {
    transcriptPath = join(sessionDir, 'transcript.txt');
    const content = lines
      .map((l) => {
        const time = l.startTimestamp.replace('T', ' ').slice(0, 19);
        const role = l.isGM ? ' (MJ)' : '';
        return `[${time}] ${l.displayName}${role}: ${l.text}`;
      })
      .join('\n');
    await writeFile(transcriptPath, `${content}\n`, 'utf-8');
  }

  return { sessionId, processed: lines.length, skipped, lines, transcriptPath };
}

/**
 * Transcribe one segment, retrying on HTTP 429 with exponential backoff
 * (honouring the API's `Retry-After` header when present).
 */
async function transcribeWithRetry(
  client: SttClient,
  segment: AudioSegment,
  filename: string,
): Promise<TranscriptLine> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.transcribe(segment);
    } catch (err) {
      const isRateLimited = err instanceof SttError && err.statusCode === 429;
      if (!isRateLimited || attempt >= MAX_RETRIES) throw err;

      const backoff = Math.min(
        (err instanceof SttError ? err.retryAfterMs : undefined) ?? BASE_BACKOFF_MS * 2 ** attempt,
        MAX_BACKOFF_MS,
      );
      console.warn(
        `[transcribe] Rate limited on ${filename}, retrying in ${Math.round(backoff / 1000)}s ` +
        `(attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(backoff);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract duration in ms from a standard 44-byte PCM WAV header. */
function wavDurationMs(buf: Buffer): number {
  if (buf.length < 44) return 0;
  const byteRate = buf.readUInt32LE(28); // bytes/second = sampleRate × channels × (bits/8)
  const dataSize = buf.readUInt32LE(40); // PCM data bytes
  return byteRate > 0 ? Math.round((dataSize / byteRate) * 1000) : 0;
}
