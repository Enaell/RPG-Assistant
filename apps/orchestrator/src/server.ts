import express, { type Express } from 'express';
import { AgentResponseSchema } from '@rpg-assistant/llm-agent';
import { openDatabase, TranscriptRepository } from '@rpg-assistant/db';
import { applyAgentResponse, createInitialState, type OrchestratorState } from './state.js';
import { log, logError } from './logger.js';

export type ServerOptions = {
  dedupWindowMs: number;
  /** Path to the (read-only, from this process's point of view) SQLite DB written by discord-bot. */
  dbPath?: string;
};

/**
 * Builds the Express app without starting a listener — lets tests hit routes
 * directly (via `app` + `fetch`/supertest-style calls) without binding a port.
 */
export function createApp(opts: ServerOptions): Express {
  const app = express();
  app.use(express.json());

  let state: OrchestratorState = createInitialState();

  // Read-only access to the same SQLite file discord-bot writes to, so the
  // dashboard can show recent transcript lines — AgentResponse has no
  // transcript field, so this is a separate, deliberately simple read path.
  const transcriptRepository = opts.dbPath
    ? new TranscriptRepository(openDatabase(opts.dbPath))
    : undefined;

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/state', (_req, res) => {
    res.json(state);
  });

  app.post('/actions', (req, res) => {
    const parsed = AgentResponseSchema.safeParse(req.body);
    if (!parsed.success) {
      logError('actions.rejected', { issues: parsed.error.issues });
      res.status(400).json({ error: 'Invalid AgentResponse payload', issues: parsed.error.issues });
      return;
    }

    const { state: nextState, outcomes } = applyAgentResponse(state, parsed.data, {
      dedupWindowMs: opts.dedupWindowMs,
    });
    state = nextState;
    log('actions.processed', {
      applied: outcomes.filter((o) => o.applied).length,
      skipped: outcomes.filter((o) => !o.applied).length,
    });
    res.json({ state, outcomes });
  });

  app.get('/transcript/recent', (req, res) => {
    if (!transcriptRepository) {
      res.status(503).json({ error: 'Transcript access not configured (DB_PATH missing)' });
      return;
    }

    const sessionId = req.query['sessionId'];
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      res.status(400).json({ error: 'sessionId query parameter is required' });
      return;
    }

    const limitRaw = Number(req.query['limit'] ?? 20);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
    const lines = transcriptRepository.findBySession(sessionId);
    res.json({ lines: lines.slice(-limit) });
  });

  return app;
}
