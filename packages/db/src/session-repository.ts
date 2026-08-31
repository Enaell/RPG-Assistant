import type Database from 'better-sqlite3';
import type { Session } from '@rpg-assistant/shared-types';

// ── Internal row type (matches the sessions table columns) ──────────────────

type SessionRow = {
  id: string;
  guild_id: string;
  channel_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  gm_user_ids: string; // JSON-encoded string[]
};

// ── Repository ───────────────────────────────────────────────────────────────

export class SessionRepository {
  private readonly stmtInsert: Database.Statement;
  private readonly stmtUpdate: Database.Statement;
  private readonly stmtFindById: Database.Statement;
  private readonly stmtFindAll: Database.Statement;
  private readonly stmtFindRecent: Database.Statement;
  private readonly stmtFindByIdPrefix: Database.Statement;

  constructor(db: Database.Database) {
    this.stmtInsert = db.prepare(`
      INSERT INTO sessions
        (id, guild_id, channel_id, started_at, ended_at, status, gm_user_ids)
      VALUES
        (@id, @guild_id, @channel_id, @started_at, @ended_at, @status, @gm_user_ids)
    `);

    this.stmtUpdate = db.prepare(`
      UPDATE sessions
      SET status = @status, ended_at = @ended_at
      WHERE id = @id
    `);

    this.stmtFindById = db.prepare(
      'SELECT * FROM sessions WHERE id = ?',
    );

    this.stmtFindAll = db.prepare(
      'SELECT * FROM sessions ORDER BY started_at DESC',
    );

    this.stmtFindRecent = db.prepare(
      'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?',
    );

    this.stmtFindByIdPrefix = db.prepare(
      "SELECT * FROM sessions WHERE id LIKE ? || '%' ORDER BY started_at DESC LIMIT 1",
    );
  }

  /** Persist a new session (called on /session start). */
  save(session: Session): void {
    this.stmtInsert.run({
      id: session.id,
      guild_id: session.guildId,
      channel_id: session.channelId,
      started_at: session.startedAt,
      ended_at: session.endedAt ?? null,
      status: session.status,
      gm_user_ids: JSON.stringify(session.gmUserIds),
    });
  }

  /** Update status and ended_at (called on /session stop). */
  update(session: Session): void {
    this.stmtUpdate.run({
      id: session.id,
      status: session.status,
      ended_at: session.endedAt ?? null,
    });
  }

  findById(id: string): Session | undefined {
    const row = this.stmtFindById.get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : undefined;
  }

  findAll(): Session[] {
    return (this.stmtFindAll.all() as SessionRow[]).map(rowToSession);
  }

  /** Returns the N most recent sessions, newest first. */
  findRecent(limit: number): Session[] {
    return (this.stmtFindRecent.all(limit) as SessionRow[]).map(rowToSession);
  }

  /**
   * Find a session by the first N characters of its UUID.
   * Useful when the user provides the short 8-char prefix shown in Discord messages.
   */
  findByIdPrefix(prefix: string): Session | undefined {
    const row = this.stmtFindByIdPrefix.get(prefix) as SessionRow | undefined;
    return row ? rowToSession(row) : undefined;
  }
}

// ── Mapper ───────────────────────────────────────────────────────────────────

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    status: row.status as Session['status'],
    gmUserIds: JSON.parse(row.gm_user_ids) as string[],
  };
}
