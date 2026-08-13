import type Database from 'better-sqlite3';
import type { TranscriptLine } from '@rpg-assistant/shared-types';

// ── Internal row type (matches the transcript_lines table columns) ───────────

type TranscriptRow = {
  id: string;
  session_id: string;
  speaker_id: string;
  speaker_name: string;
  display_name: string;
  text: string;
  start_timestamp: string;
  end_timestamp: string;
  is_gm: number; // SQLite stores booleans as 0/1
  created_at: string;
};

// ── Repository ───────────────────────────────────────────────────────────────

export class TranscriptRepository {
  private readonly stmtInsert: Database.Statement;
  private readonly stmtFindBySession: Database.Statement;
  private readonly stmtCountBySession: Database.Statement;

  constructor(db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO transcript_lines
        (id, session_id, speaker_id, speaker_name, display_name,
         text, start_timestamp, end_timestamp, is_gm)
      VALUES
        (@id, @session_id, @speaker_id, @speaker_name, @display_name,
         @text, @start_timestamp, @end_timestamp, @is_gm)
    `);

    this.stmtFindBySession = db.prepare(`
      SELECT * FROM transcript_lines
      WHERE session_id = ?
      ORDER BY start_timestamp ASC
    `);

    this.stmtCountBySession = db.prepare(`
      SELECT COUNT(*) AS count FROM transcript_lines WHERE session_id = ?
    `);
  }

  /** Persist a single transcribed utterance. */
  save(line: TranscriptLine): void {
    this.stmtInsert.run({
      id: line.id,
      session_id: line.sessionId,
      speaker_id: line.speakerId,
      speaker_name: line.speakerName,
      display_name: line.displayName,
      text: line.text,
      start_timestamp: line.startTimestamp,
      end_timestamp: line.endTimestamp,
      is_gm: line.isGM ? 1 : 0,
    });
  }

  /** Retrieve all lines for a session, chronologically ordered. */
  findBySession(sessionId: string): TranscriptLine[] {
    return (this.stmtFindBySession.all(sessionId) as TranscriptRow[]).map(rowToLine);
  }

  /** Number of transcript lines saved for a given session. */
  countBySession(sessionId: string): number {
    const row = this.stmtCountBySession.get(sessionId) as { count: number; };
    return row.count;
  }
}

// ── Mapper ───────────────────────────────────────────────────────────────────

function rowToLine(row: TranscriptRow): TranscriptLine {
  return {
    id: row.id,
    sessionId: row.session_id,
    speakerId: row.speaker_id,
    speakerName: row.speaker_name,
    displayName: row.display_name,
    text: row.text,
    startTimestamp: row.start_timestamp,
    endTimestamp: row.end_timestamp,
    isGM: row.is_gm === 1,
  };
}
