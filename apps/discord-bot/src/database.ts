/**
 * Singleton database connection for the discord-bot process.
 *
 * Imported by session-manager (session lifecycle) and audio-output (transcript lines).
 * Initialised once at module load time — DB_PATH must be a valid writable path.
 *
 * The `DB_PATH` env var is validated by index.ts before this module is imported.
 */
import { resolve } from 'node:path';
import { openDatabase, SessionRepository, TranscriptRepository } from '@rpg-assistant/db';

const DB_PATH = resolve(
  process.cwd(),
  process.env['DB_PATH'] ?? './data/rpg-assistant.db',
);

const db = openDatabase(DB_PATH);

console.log(`🗃️  Base de données ouverte : ${DB_PATH}`);

export const sessionRepository = new SessionRepository(db);
export const transcriptRepository = new TranscriptRepository(db);
