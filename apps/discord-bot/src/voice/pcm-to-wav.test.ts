import { describe, it, expect } from 'vitest';
import { pcmToWav, stereoToMono, downsample, toSttWav } from './pcm-to-wav';

describe('pcmToWav', () => {
  it('writes a valid 44-byte RIFF/WAVE header followed by the PCM data', () => {
    const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const wav = pcmToWav(pcm, 16_000, 1, 16);

    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ');
    expect(wav.readUInt32LE(16)).toBe(16); // PCM sub-chunk size
    expect(wav.readUInt16LE(20)).toBe(1); // audio format: PCM
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt32LE(24)).toBe(16_000); // sample rate
    expect(wav.readUInt32LE(28)).toBe(16_000 * 1 * 2); // byte rate
    expect(wav.readUInt16LE(32)).toBe(2); // block align
    expect(wav.readUInt16LE(34)).toBe(16); // bit depth
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44)).toEqual(pcm);
  });

  it('computes byte rate and block align correctly for stereo audio', () => {
    const pcm = Buffer.alloc(8);
    const wav = pcmToWav(pcm, 48_000, 2, 16);

    expect(wav.readUInt32LE(28)).toBe(48_000 * 2 * 2); // byteRate
    expect(wav.readUInt16LE(32)).toBe(4); // blockAlign
  });
});

describe('stereoToMono', () => {
  it('averages left and right 16-bit samples per frame', () => {
    const stereo = Buffer.alloc(8);
    stereo.writeInt16LE(100, 0); // L0
    stereo.writeInt16LE(200, 2); // R0
    stereo.writeInt16LE(-50, 4); // L1
    stereo.writeInt16LE(50, 6); // R1

    const mono = stereoToMono(stereo);

    expect(mono.length).toBe(4); // 2 frames × 2 bytes
    expect(mono.readInt16LE(0)).toBe(150); // (100+200)/2
    expect(mono.readInt16LE(2)).toBe(0); // (-50+50)/2
  });

  it('drops a trailing partial frame', () => {
    const stereo = Buffer.alloc(6); // 1.5 frames worth of bytes
    const mono = stereoToMono(stereo);
    expect(mono.length).toBe(2); // only the one full frame is kept
  });
});

describe('downsample', () => {
  it('returns the input unchanged when factor is 1', () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    expect(downsample(pcm, 1)).toBe(pcm);
  });

  it('keeps every Nth sample (simple decimation)', () => {
    const pcm = Buffer.alloc(6 * 2); // 6 samples
    for (let i = 0; i < 6; i++) pcm.writeInt16LE(i * 10, i * 2);

    const out = downsample(pcm, 3); // 48kHz -> 16kHz

    expect(out.length).toBe(2 * 2); // 2 samples kept
    expect(out.readInt16LE(0)).toBe(0); // sample 0
    expect(out.readInt16LE(2)).toBe(30); // sample 3
  });
});

describe('toSttWav', () => {
  it('converts 48kHz stereo PCM into a 16kHz mono WAV buffer', () => {
    // 48 stereo frames (48000 samples/sec * 1ms would be too small; use a
    // round number of frames divisible by the downsample factor of 3)
    const frameCount = 9;
    const rawPcm = Buffer.alloc(frameCount * 4);
    for (let i = 0; i < frameCount; i++) {
      rawPcm.writeInt16LE(1000, i * 4); // L
      rawPcm.writeInt16LE(1000, i * 4 + 2); // R
    }

    const wav = toSttWav(rawPcm);

    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16_000); // sample rate
    expect(wav.readUInt16LE(22)).toBe(1); // mono

    const expectedOutputSamples = Math.floor(Math.floor(frameCount / 3));
    expect(wav.readUInt32LE(40)).toBe(expectedOutputSamples * 2); // data size
  });
});
