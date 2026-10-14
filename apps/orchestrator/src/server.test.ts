import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { openDatabase, SessionRepository, TranscriptRepository } from '@rpg-assistant/db';
import { createApp } from './server';

async function startApp(dbPath?: string): Promise<{ baseUrl: string; close: () => Promise<void>; }> {
  const app = createApp({ dedupWindowMs: 4_000, dbPath });
  const server: Server = await new Promise((resolvePromise) => {
    const s = app.listen(0, '127.0.0.1', () => resolvePromise(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}

const validResponse = {
  scene: 'combat',
  mood: 'tendu',
  confidence: 0.9,
  actions: [{ type: 'music', track: 'battle_theme' }],
  trigger: 'keyword',
  timestamp: '2026-01-01T10:00:00.000Z',
};

describe('orchestrator server', () => {
  let app: { baseUrl: string; close: () => Promise<void>; };

  afterEach(async () => {
    await app?.close();
  });

  it('GET /health returns ok', async () => {
    app = await startApp();
    const res = await fetch(`${app.baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('POST /actions accepts a valid AgentResponse and updates state', async () => {
    app = await startApp();
    const res = await fetch(`${app.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validResponse),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: { scene: string; activeMusic: { track: string; }; }; };
    expect(body.state.scene).toBe('combat');
    expect(body.state.activeMusic.track).toBe('battle_theme');

    const stateRes = await fetch(`${app.baseUrl}/state`);
    const state = (await stateRes.json()) as { scene: string; };
    expect(state.scene).toBe('combat');
  });

  it('POST /actions rejects an unrecognized action type', async () => {
    app = await startApp();
    const res = await fetch(`${app.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validResponse, actions: [{ type: 'explode' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /actions rejects a payload missing required fields', async () => {
    app = await startApp();
    const res = await fetch(`${app.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: 'combat' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /transcript/recent returns 503 when no DB_PATH was configured', async () => {
    app = await startApp();
    const res = await fetch(`${app.baseUrl}/transcript/recent?sessionId=session-1`);
    expect(res.status).toBe(503);
  });
});

describe('orchestrator server with transcript access', () => {
  let tmpDir: string;
  let dbPath: string;
  let app: { baseUrl: string; close: () => Promise<void>; };

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orchestrator-test-'));
    dbPath = join(tmpDir, 'test.db');
    const db = openDatabase(dbPath);
    new SessionRepository(db).save({
      id: 'session-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      startedAt: '2026-01-01T09:00:00.000Z',
      status: 'active',
      gmUserIds: ['gm-1'],
    });
    const repo = new TranscriptRepository(db);
    repo.save({
      id: 'line-1',
      sessionId: 'session-1',
      speakerId: 'user-1',
      speakerName: 'alice',
      displayName: 'Alice',
      text: 'Bonjour aventuriers',
      startTimestamp: '2026-01-01T10:00:00.000Z',
      endTimestamp: '2026-01-01T10:00:03.000Z',
      isGM: true,
    });
    db.close();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await app?.close();
  });

  it('GET /transcript/recent returns lines for the requested session', async () => {
    app = await startApp(dbPath);
    const res = await fetch(`${app.baseUrl}/transcript/recent?sessionId=session-1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: Array<{ text: string; }>; };
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]?.text).toBe('Bonjour aventuriers');
  });

  it('GET /transcript/recent requires a sessionId query param', async () => {
    app = await startApp(dbPath);
    const res = await fetch(`${app.baseUrl}/transcript/recent`);
    expect(res.status).toBe(400);
  });
});
