// Mirrors apps/orchestrator/src/handlers.ts + state.ts shapes. Not imported
// from the orchestrator package directly to keep this app decoupled (it only
// talks to the orchestrator over HTTP, per the module-boundary rule that
// apps/ must not import other apps/).
export type ActiveMusic = { track: string; fadeIn?: number; dispatchedAt: string; };
export type ActiveImage = { query: string; source: 'library' | 'generate'; dispatchedAt: string; };
export type LastGmTip = { text: string; priority: 'low' | 'normal' | 'high'; dispatchedAt: string; };
export type LastRuleHelp = { topic: string; system: string; dispatchedAt: string; };

export type OrchestratorState = {
  scene: string;
  mood: string;
  activeMusic: ActiveMusic | null;
  activeImage: ActiveImage | null;
  lastGmTip: LastGmTip | null;
  lastRuleHelp: LastRuleHelp | null;
  lastTrigger: 'polling' | 'keyword' | 'manual' | null;
  lastConfidence: number | null;
  updatedAt: string;
};

export type TranscriptLine = {
  id: string;
  displayName: string;
  text: string;
  isGM: boolean;
  startTimestamp: string;
};

const BASE_URL = import.meta.env.VITE_ORCHESTRATOR_URL ?? 'http://127.0.0.1:3001';

export async function fetchState(): Promise<OrchestratorState> {
  const res = await fetch(`${BASE_URL}/state`);
  if (!res.ok) throw new Error(`GET /state failed with HTTP ${res.status}`);
  return (await res.json()) as OrchestratorState;
}

/** Returns an empty array (rather than throwing) if transcript access isn't configured. */
export async function fetchRecentTranscript(sessionId: string, limit = 20): Promise<TranscriptLine[]> {
  const res = await fetch(
    `${BASE_URL}/transcript/recent?sessionId=${encodeURIComponent(sessionId)}&limit=${limit}`,
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { lines: TranscriptLine[]; };
  return body.lines;
}
