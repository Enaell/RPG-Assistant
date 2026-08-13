import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type { Database };

/**
 * Open (or create) the SQLite database at `filePath` and apply the schema.
 * Uses WAL mode and foreign-key enforcement.
 * Idempotent — safe to call on every startup.
 */
export function openDatabase(filePath: string): Database.Database {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(filePath);

  // WAL: readers never block writers and vice-versa (better for future services)
  db.pragma('journal_mode = WAL');
  // Enforce FK constraints (off by default in SQLite)
  db.pragma('foreign_keys = ON');

  applySchema(db);

  return db;
}

// ── DDL ─────────────────────────────────────────────────────────────────────

function applySchema(db: Database.Database): void {
  db.exec(`
    -- ── Sessions ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      guild_id    TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      started_at  TEXT NOT NULL,          -- ISO 8601
      ended_at    TEXT,                   -- NULL while active
      status      TEXT NOT NULL DEFAULT 'active',
      gm_user_ids TEXT NOT NULL           -- JSON array of Discord user Snowflakes
    );

    -- ── Transcript lines ───────────────────────────────────────────────────
    -- One row per utterance returned by the STT API.
    CREATE TABLE IF NOT EXISTS transcript_lines (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL REFERENCES sessions(id),
      speaker_id      TEXT NOT NULL,      -- Discord user Snowflake
      speaker_name    TEXT NOT NULL,      -- Discord username
      display_name    TEXT NOT NULL,      -- Guild nickname or username
      text            TEXT NOT NULL,      -- Transcribed speech
      start_timestamp TEXT NOT NULL,      -- ISO 8601 — when the user started speaking
      end_timestamp   TEXT NOT NULL,      -- ISO 8601 — when the user stopped speaking
      is_gm           INTEGER NOT NULL DEFAULT 0,   -- 1 = Game Master, 0 = player
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))  -- insertion timestamp
    );

    CREATE INDEX IF NOT EXISTS idx_transcript_session
      ON transcript_lines(session_id);

    CREATE INDEX IF NOT EXISTS idx_transcript_speaker
      ON transcript_lines(speaker_id);
  `);
}
