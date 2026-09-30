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
  source_file: string | null;
};

// ── Repository ───────────────────────────────────────────────────────────────

export class TranscriptRepository {
  private readonly stmtInsert: Database.Statement;
  private readonly stmtFindBySession: Database.Statement;
  private readonly stmtCountBySession: Database.Statement;
  private readonly stmtExistsBySessionAndSourceFile: Database.Statement;

  constructor(db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT OR IGNORE INTO transcript_lines
        (id, session_id, speaker_id, speaker_name, display_name,
         text, start_timestamp, end_timestamp, is_gm, source_file)
      VALUES
        (@id, @session_id, @speaker_id, @speaker_name, @display_name,
         @text, @start_timestamp, @end_timestamp, @is_gm, @source_file)
    `);

    this.stmtFindBySession = db.prepare(`
      SELECT * FROM transcript_lines
      WHERE session_id = ?
      ORDER BY start_timestamp ASC
    `);

    this.stmtCountBySession = db.prepare(`
      SELECT COUNT(*) AS count FROM transcript_lines WHERE session_id = ?
    `);

    this.stmtExistsBySessionAndSourceFile = db.prepare(`
      SELECT 1 FROM transcript_lines WHERE session_id = ? AND source_file = ? LIMIT 1
    `);
  }

  /**
   * Persist a single transcribed utterance.
   *
   * Idempotent when `line.sourceFile` is set (post-session transcription):
   * a duplicate `(sessionId, sourceFile)` pair is silently ignored thanks to
   * the partial unique index, so re-running `/session transcribe` never
   * inserts the same line twice. Returns `true` if a row was actually
   * inserted, `false` if it was ignored as a duplicate.
   */
  save(line: TranscriptLine): boolean {
    const result = this.stmtInsert.run({
      id: line.id,
      session_id: line.sessionId,
      speaker_id: line.speakerId,
      speaker_name: line.speakerName,
      display_name: line.displayName,
      text: line.text,
      start_timestamp: line.startTimestamp,
      end_timestamp: line.endTimestamp,
      is_gm: line.isGM ? 1 : 0,
      source_file: line.sourceFile ?? null,
    });
    return result.changes > 0;
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

  /**
   * True if a line from this exact WAV file was already transcribed and
   * saved for this session. Used to skip re-transcribing (and re-billing
   * the STT API for) files already processed by a previous `/session
   * transcribe` run.
   */
  existsBySessionAndSourceFile(sessionId: string, sourceFile: string): boolean {
    return this.stmtExistsBySessionAndSourceFile.get(sessionId, sourceFile) !== undefined;
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
    sourceFile: row.source_file ?? undefined,
  };
}
