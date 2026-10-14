import type { SessionStatus, TranscriptLine } from '@rpg-assistant/shared-types';

// Re-exported so callers don't need to depend on shared-types just for this name.
export type ContextStatus = SessionStatus;

export type ActiveMusic = {
  track: string;
  fadeIn?: number;
  /** ISO 8601 — when this track was set as active. */
  setAt: string;
};

export type ActiveImage = {
  query: string;
  source: 'library' | 'generate';
  /** ISO 8601 — when this image was set as active. */
  setAt: string;
};

/**
 * Immutable snapshot of the current session context — what the LLM agent's
 * prompt is built from, and what the orchestrator/dashboard read.
 */
export type ContextSnapshot = {
  status: ContextStatus;
  sessionId: string | null;
  scene: string;
  mood: string;
  /** Most recent transcript lines, oldest first, capped at `historyLimit`. */
  history: TranscriptLine[];
  activeMusic: ActiveMusic | null;
  activeImage: ActiveImage | null;
  /** ISO 8601 — last time any field on this snapshot changed. */
  updatedAt: string;
};

/**
 * Typed events emitted by ContextManager, consumed by whatever forwards
 * context changes to the orchestrator (not implemented here — see README).
 */
export type ContextEvent =
  | { type: 'stateChanged'; status: ContextStatus; previous: ContextStatus; }
  | { type: 'sceneChanged'; scene: string; mood: string; }
  | { type: 'transcriptAppended'; line: TranscriptLine; }
  | { type: 'musicChanged'; music: ActiveMusic | null; }
  | { type: 'imageChanged'; image: ActiveImage | null; };

export type ContextEventListener = (event: ContextEvent) => void;

export class InvalidTransitionError extends Error {
  constructor(from: ContextStatus, to: ContextStatus) {
    super(`Invalid session state transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
