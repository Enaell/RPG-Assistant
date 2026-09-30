import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TranscriptRepository } from '@rpg-assistant/db';
import type { AudioSegment, TranscriptLine } from '@rpg-assistant/shared-types';
import type { SttClient } from '@rpg-assistant/stt-client';
import { SttError } from '@rpg-assistant/stt-client';

const { transcribeMock } = vi.hoisted(() => ({ transcribeMock: vi.fn() }));
const { readdirMock, readFileMock, writeFileMock } = vi.hoisted(() => ({
  readdirMock: vi.fn(),
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readdir: readdirMock,
  readFile: readFileMock,
  writeFile: writeFileMock,
}));

vi.mock('@rpg-assistant/stt-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rpg-assistant/stt-client')>();
  return {
    ...actual,
    createSttClient: () => ({ transcribe: transcribeMock }),
  };
});

import { transcribeRecordingSession, transcribeWithRetry } from './post-session-transcriber';

function makeLine(overrides: Partial<TranscriptLine> = {}): TranscriptLine {
  return {
    id: 'line-1',
    sessionId: 'session-1',
    speakerId: 'recording:Alice',
    speakerName: 'Alice',
    displayName: 'Alice',
    text: 'Bonjour aventuriers',
    startTimestamp: '2026-01-01T10:00:00.000Z',
    endTimestamp: '2026-01-01T10:00:03.000Z',
    isGM: false,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<TranscriptRepository> = {}): TranscriptRepository {
  return {
    save: vi.fn().mockReturnValue(true),
    findBySession: vi.fn().mockReturnValue([]),
    countBySession: vi.fn().mockReturnValue(0),
    existsBySessionAndSourceFile: vi.fn().mockReturnValue(false),
    ...overrides,
  } as unknown as TranscriptRepository;
}

// A buffer shorter than the 44-byte WAV header — wavDurationMs() safely returns 0 for it.
const SHORT_BUFFER = Buffer.alloc(10);

describe('transcribeRecordingSession', () => {
  beforeEach(() => {
    transcribeMock.mockReset();
    readdirMock.mockReset();
    readFileMock.mockReset();
    writeFileMock.mockReset();
  });

  it('processes WAV files in chronological order regardless of directory listing order', async () => {
    readdirMock.mockResolvedValue([
      '2026-01-01T10-00-05_Bob.wav',
      '2026-01-01T10-00-01_Alice.wav',
    ]);
    readFileMock.mockResolvedValue(SHORT_BUFFER);
    transcribeMock.mockImplementation(async (segment: AudioSegment) =>
      makeLine({ displayName: segment.displayName, text: `hi from ${segment.displayName}` }),
    );

    const repo = makeRepo();
    const result = await transcribeRecordingSession('session-1', '/recordings', repo, {
      mistralApiKey: 'key',
    });

    const callOrder = transcribeMock.mock.calls.map(
      ([segment]: [AudioSegment]) => segment.displayName,
    );
    expect(callOrder).toEqual(['Alice', 'Bob']); // lexicographic == chronological (ISO prefix)
    expect(result.processed).toBe(2);
    expect(result.duplicates).toBe(0);
  });

  it('skips files already transcribed in a previous run without calling the STT API', async () => {
    readdirMock.mockResolvedValue([
      '2026-01-01T10-00-01_Alice.wav',
      '2026-01-01T10-00-05_Bob.wav',
    ]);
    readFileMock.mockResolvedValue(SHORT_BUFFER);
    transcribeMock.mockResolvedValue(makeLine());

    const repo = makeRepo({
      existsBySessionAndSourceFile: vi
        .fn()
        .mockImplementation((_sessionId: string, file: string) => file.includes('Alice')),
    });

    const result = await transcribeRecordingSession('session-1', '/recordings', repo, {
      mistralApiKey: 'key',
    });

    expect(transcribeMock).toHaveBeenCalledTimes(1); // only Bob's file
    expect(result.duplicates).toBe(1);
    expect(result.processed).toBe(1);
  });

  it('tags saved lines with their source WAV filename', async () => {
    readdirMock.mockResolvedValue(['2026-01-01T10-00-01_Alice.wav']);
    readFileMock.mockResolvedValue(SHORT_BUFFER);
    transcribeMock.mockResolvedValue(makeLine());

    const saveMock = vi.fn().mockReturnValue(true);
    const repo = makeRepo({ save: saveMock });

    await transcribeRecordingSession('session-1', '/recordings', repo, { mistralApiKey: 'key' });

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFile: '2026-01-01T10-00-01_Alice.wav' }),
    );
  });

  it('counts a file as a duplicate (not processed) when repo.save reports no insert', async () => {
    readdirMock.mockResolvedValue(['2026-01-01T10-00-01_Alice.wav']);
    readFileMock.mockResolvedValue(SHORT_BUFFER);
    transcribeMock.mockResolvedValue(makeLine());

    const repo = makeRepo({ save: vi.fn().mockReturnValue(false) });
    const result = await transcribeRecordingSession('session-1', '/recordings', repo, {
      mistralApiKey: 'key',
    });

    expect(result.processed).toBe(0);
    expect(result.duplicates).toBe(1);
  });
});

describe('transcribeWithRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const segment: AudioSegment = {
    segmentId: 'seg-1',
    sessionId: 'session-1',
    userId: 'recording:Alice',
    username: 'Alice',
    displayName: 'Alice',
    isGM: false,
    startTimestamp: new Date('2026-01-01T10:00:00.000Z'),
    endTimestamp: new Date('2026-01-01T10:00:03.000Z'),
    durationMs: 3000,
    wavBuffer: SHORT_BUFFER,
  };

  it('retries a 429 after the Retry-After delay, then returns the successful result', async () => {
    vi.useFakeTimers();
    const client: SttClient = {
      transcribe: vi
        .fn()
        .mockRejectedValueOnce(new SttError('rate limited', 429, 1_500))
        .mockResolvedValueOnce(makeLine({ text: 'ok on retry' })),
    };

    const promise = transcribeWithRetry(client, segment, 'file.wav');
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await promise;

    expect(result.text).toBe('ok on retry');
    expect(client.transcribe).toHaveBeenCalledTimes(2);
  });

  it('falls back to exponential backoff when Retry-After is absent', async () => {
    vi.useFakeTimers();
    const client: SttClient = {
      transcribe: vi
        .fn()
        .mockRejectedValueOnce(new SttError('rate limited', 429))
        .mockResolvedValueOnce(makeLine()),
    };

    const promise = transcribeWithRetry(client, segment, 'file.wav');
    await vi.advanceTimersByTimeAsync(2_000); // BASE_BACKOFF_MS for attempt 0
    await promise;

    expect(client.transcribe).toHaveBeenCalledTimes(2);
  });

  it('gives up after the maximum number of retries and rethrows the last error', async () => {
    vi.useFakeTimers();
    const persistentError = new SttError('still rate limited', 429, 10);
    const client: SttClient = {
      transcribe: vi.fn().mockRejectedValue(persistentError),
    };

    const promise = transcribeWithRetry(client, segment, 'file.wav');
    const assertion = expect(promise).rejects.toBe(persistentError);
    // Let all backoff timers elapse (6 attempts total: initial + 5 retries).
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }
    await assertion;

    expect(client.transcribe).toHaveBeenCalledTimes(6);
  });

  it('does not retry non-429 errors', async () => {
    const otherError = new SttError('server exploded', 500);
    const client: SttClient = {
      transcribe: vi.fn().mockRejectedValue(otherError),
    };

    await expect(transcribeWithRetry(client, segment, 'file.wav')).rejects.toBe(otherError);
    expect(client.transcribe).toHaveBeenCalledTimes(1);
  });
});
