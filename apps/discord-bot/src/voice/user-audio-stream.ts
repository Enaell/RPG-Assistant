import { Writable, pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { EndBehaviorType, type VoiceReceiver } from '@discordjs/voice';
import prism from 'prism-media';
import { toSttWav } from './pcm-to-wav';

const pipelineAsync = promisify(pipeline);

// ── Discord Opus constants ──────────────────────────────────
// Discord sends Opus audio at 48 kHz, stereo, 20 ms frames (960 samples/ch)
const OPUS_SAMPLE_RATE = 48_000;
const OPUS_CHANNELS = 2;
const OPUS_FRAME_SIZE = 960;

// End the stream 500 ms after the last audio packet (user stopped speaking)
const SILENCE_DURATION_MS = 500;

// Discard captures shorter than 200 ms (noise bursts, connection artifacts)
const MIN_SPEECH_DURATION_MS = 200;

// ── Public types ────────────────────────────────────────────

export type CaptureResult = {
  /** WAV buffer at 16 kHz mono 16-bit PCM, ready for STT */
  wavBuffer: Buffer;
  /** Actual speech duration in milliseconds (excludes trailing silence) */
  durationMs: number;
};

// ── Implementation ──────────────────────────────────────────

/**
 * Subscribe to a user's audio stream and collect a full utterance.
 *
 * The promise resolves when 500 ms of silence is detected or when the user
 * disconnects. Returns null if the utterance is too short to be meaningful.
 *
 * Audio pipeline:
 *   Discord Opus packets → OpusDecoder (48 kHz stereo PCM) → buffer
 *   → stereoToMono → downsample 48→16 kHz → WAV header
 */
export async function captureUserUtterance(
  receiver: VoiceReceiver,
  userId: string,
): Promise<CaptureResult | null> {
  const startTime = Date.now();
  let lastAudioTime = startTime;

  const opusStream = receiver.subscribe(userId, {
    end: {
      behavior: EndBehaviorType.AfterSilence,
      duration: SILENCE_DURATION_MS,
    },
  });

  const decoder = new prism.opus.Decoder({
    rate: OPUS_SAMPLE_RATE,
    channels: OPUS_CHANNELS,
    frameSize: OPUS_FRAME_SIZE,
  });

  const chunks: Buffer[] = [];

  const collector = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      lastAudioTime = Date.now();
      callback();
    },
  });

  try {
    await pipelineAsync(opusStream as NodeJS.ReadableStream, decoder, collector);
  } catch (err) {
    // Stream may end abruptly if the user disconnects mid-utterance.
    // Process whatever audio we managed to capture.
    if (chunks.length === 0) return null;
    console.warn(
      `[voice] Audio stream for ${userId} ended unexpectedly: ${(err as Error).message}`,
    );
  }

  // Actual speech = time of last audio packet − start
  // (lastAudioTime is updated on each PCM chunk, before the silence window)
  const durationMs = lastAudioTime - startTime;

  if (chunks.length === 0 || durationMs < MIN_SPEECH_DURATION_MS) {
    return null;
  }

  const rawPcm = Buffer.concat(chunks);
  const wavBuffer = toSttWav(rawPcm);

  return { wavBuffer, durationMs };
}
