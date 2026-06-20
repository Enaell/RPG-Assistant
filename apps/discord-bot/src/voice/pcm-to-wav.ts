/**
 * Convert a raw PCM buffer to a WAV file buffer with a RIFF/WAV header.
 */
export function pcmToWav(
  pcm: Buffer,
  sampleRate: number,
  channels: number,
  bitDepth: 16 | 32 = 16,
): Buffer {
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const header = Buffer.alloc(44);

  // RIFF chunk descriptor
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4); // file size − 8 bytes
  header.write('WAVE', 8, 'ascii');

  // fmt sub-chunk
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);        // PCM sub-chunk size = 16
  header.writeUInt16LE(1, 20);         // audio format: 1 = PCM (uncompressed)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);

  // data sub-chunk
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * Convert stereo interleaved 16-bit PCM to mono by averaging L+R channels.
 *
 * Input layout:  [L0_lo, L0_hi, R0_lo, R0_hi, L1_lo, L1_hi, R1_lo, R1_hi, ...]
 * Output layout: [M0_lo, M0_hi, M1_lo, M1_hi, ...]
 */
export function stereoToMono(pcm: Buffer): Buffer {
  const frameCount = Math.floor(pcm.length / 4); // 4 bytes per stereo frame (2ch × 2 bytes)
  const mono = Buffer.allocUnsafe(frameCount * 2);

  for (let i = 0; i < frameCount; i++) {
    const left = pcm.readInt16LE(i * 4);
    const right = pcm.readInt16LE(i * 4 + 2);
    mono.writeInt16LE(Math.round((left + right) / 2), i * 2);
  }

  return mono;
}

/**
 * Downsample 16-bit mono PCM by an integer factor (simple decimation).
 *
 * factor=3 converts 48 000 Hz → 16 000 Hz (48 000 / 3 = 16 000).
 *
 * Note: simple decimation can introduce aliasing for content above the
 * Nyquist frequency of the target rate. For speech (<8 kHz) this is fine.
 */
export function downsample(pcm: Buffer, factor: number): Buffer {
  if (factor === 1) return pcm;

  const inputSamples = Math.floor(pcm.length / 2); // 16-bit = 2 bytes/sample
  const outputSamples = Math.floor(inputSamples / factor);
  const output = Buffer.allocUnsafe(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    output.writeInt16LE(pcm.readInt16LE(i * factor * 2), i * 2);
  }

  return output;
}

/**
 * Convert raw 48 kHz stereo PCM (Discord / Opus decoder output) to a WAV
 * buffer at 16 kHz mono — the preferred input format for Voxtral and Whisper.
 *
 * Pipeline: stereo → mono → 48 kHz→16 kHz decimation (÷3) → WAV header
 */
export function toSttWav(rawPcm48kHzStereo: Buffer): Buffer {
  const mono = stereoToMono(rawPcm48kHzStereo);
  const resampled = downsample(mono, 3);         // 48 000 / 3 = 16 000 Hz
  return pcmToWav(resampled, 16_000, 1, 16);
}
