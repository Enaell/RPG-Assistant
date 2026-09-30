import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import type { TranscriptLine, Session } from '@rpg-assistant/shared-types';
import { openDatabase } from './database';
import { TranscriptRepository } from './transcript-repository';
import { SessionRepository } from './session-repository';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    startedAt: '2026-01-01T10:00:00.000Z',
    status: 'active',
    gmUserIds: ['gm-1'],
    ...overrides,
  };
}

function makeLine(overrides: Partial<TranscriptLine> = {}): TranscriptLine {
  return {
    id: crypto.randomUUID(),
    sessionId: 'session-1',
    speakerId: 'user-1',
    speakerName: 'alice',
    displayName: 'Alice',
    text: 'Bonjour',
    startTimestamp: '2026-01-01T10:00:00.000Z',
    endTimestamp: '2026-01-01T10:00:03.000Z',
    isGM: true,
    ...overrides,
  };
}

describe('TranscriptRepository', () => {
  let db: Database.Database;
  let sessions: SessionRepository;
  let transcripts: TranscriptRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    sessions = new SessionRepository(db);
    transcripts = new TranscriptRepository(db);
    sessions.save(makeSession());
  });

  it('saves and retrieves transcript lines chronologically', () => {
    transcripts.save(makeLine({ id: 'l2', startTimestamp: '2026-01-01T10:00:05.000Z' }));
    transcripts.save(makeLine({ id: 'l1', startTimestamp: '2026-01-01T10:00:01.000Z' }));

    const lines = transcripts.findBySession('session-1');
    expect(lines.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(transcripts.countBySession('session-1')).toBe(2);
  });

  it('round-trips isGM and sourceFile fields', () => {
    transcripts.save(makeLine({ id: 'l1', isGM: false, sourceFile: '2026-01-01T10-00-00_Alice.wav' }));
    const [line] = transcripts.findBySession('session-1');
    expect(line?.isGM).toBe(false);
    expect(line?.sourceFile).toBe('2026-01-01T10-00-00_Alice.wav');
  });

  it('leaves sourceFile undefined for real-time lines (no source file)', () => {
    transcripts.save(makeLine({ id: 'l1' }));
    const [line] = transcripts.findBySession('session-1');
    expect(line?.sourceFile).toBeUndefined();
  });

  describe('idempotency (session_id + source_file)', () => {
    it('ignores a duplicate insert for the same session_id + source_file pair', () => {
      const file = '2026-01-01T10-00-00_Alice.wav';

      const firstInsert = transcripts.save(makeLine({ id: 'l1', sourceFile: file, text: 'first pass' }));
      const secondInsert = transcripts.save(
        makeLine({ id: 'l2', sourceFile: file, text: 'duplicate re-run' }),
      );

      expect(firstInsert).toBe(true);
      expect(secondInsert).toBe(false);

      const lines = transcripts.findBySession('session-1');
      expect(lines).toHaveLength(1);
      expect(lines[0]?.text).toBe('first pass');
    });

    it('allows the same source_file across different sessions', () => {
      sessions.save(makeSession({ id: 'session-2' }));
      const file = '2026-01-01T10-00-00_Alice.wav';

      transcripts.save(makeLine({ id: 'l1', sessionId: 'session-1', sourceFile: file }));
      const inserted = transcripts.save(makeLine({ id: 'l2', sessionId: 'session-2', sourceFile: file }));

      expect(inserted).toBe(true);
    });

    it('allows multiple lines with no source_file (real-time mode) in the same session', () => {
      const first = transcripts.save(makeLine({ id: 'l1' }));
      const second = transcripts.save(makeLine({ id: 'l2' }));

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(transcripts.countBySession('session-1')).toBe(2);
    });

    it('existsBySessionAndSourceFile reflects previously saved files', () => {
      const file = '2026-01-01T10-00-00_Alice.wav';
      expect(transcripts.existsBySessionAndSourceFile('session-1', file)).toBe(false);

      transcripts.save(makeLine({ id: 'l1', sourceFile: file }));

      expect(transcripts.existsBySessionAndSourceFile('session-1', file)).toBe(true);
      expect(transcripts.existsBySessionAndSourceFile('session-1', 'other.wav')).toBe(false);
    });
  });
});
