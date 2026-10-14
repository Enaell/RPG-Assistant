import type { TranscriptLine } from '@rpg-assistant/shared-types';
import {
  InvalidTransitionError,
  type ActiveImage,
  type ActiveMusic,
  type ContextEvent,
  type ContextEventListener,
  type ContextSnapshot,
  type ContextStatus,
} from './types.js';

const DEFAULT_HISTORY_LIMIT = 20;

// Valid transitions, matching the diagram in copilot-instructions.md:
//   IDLE → ACTIVE → PAUSED → ACTIVE → ENDED
//                    ↑_____↓
// ENDED is terminal — a new session gets a fresh ContextManager instance
// rather than reusing this one (mirrors session-manager.ts's own pattern of
// creating a new Session object per /session start).
type TransitionRule = { from: ContextStatus[]; to: ContextStatus; };
const TRANSITIONS: Record<'start' | 'pause' | 'resume' | 'end', TransitionRule> = {
  start: { from: ['idle'], to: 'active' },
  pause: { from: ['active'], to: 'paused' },
  resume: { from: ['paused'], to: 'active' },
  end: { from: ['active', 'paused'], to: 'ended' },
};

export type ContextManagerOptions = {
  /** Max number of transcript lines kept in history. Default 20. */
  historyLimit?: number;
};

/**
 * Session state machine: tracks status, scene/mood, transcript history, and
 * active music/image. Emits typed events for whatever bridges them to the
 * orchestrator — this package has no knowledge of HTTP or the orchestrator.
 *
 * Per ADR: the Discord bot must only mutate session state through this class,
 * never call the orchestrator directly.
 */
export class ContextManager {
  private readonly historyLimit: number;
  private readonly listeners = new Set<ContextEventListener>();

  private status: ContextStatus = 'idle';
  private sessionId: string | null = null;
  private scene = '';
  private mood = '';
  private history: TranscriptLine[] = [];
  private activeMusic: ActiveMusic | null = null;
  private activeImage: ActiveImage | null = null;
  private updatedAt: string = new Date().toISOString();

  constructor(options: ContextManagerOptions = {}) {
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  }

  // ── State transitions ────────────────────────────────────────

  start(sessionId: string): void {
    this.transition('start');
    this.sessionId = sessionId;
    this.scene = '';
    this.mood = '';
    this.history = [];
    this.activeMusic = null;
    this.activeImage = null;
  }

  pause(): void {
    this.transition('pause');
  }

  resume(): void {
    this.transition('resume');
  }

  end(): void {
    this.transition('end');
  }

  private transition(action: 'start' | 'pause' | 'resume' | 'end'): void {
    const rule = TRANSITIONS[action];
    if (!rule.from.includes(this.status)) {
      throw new InvalidTransitionError(this.status, rule.to);
    }
    const previous = this.status;
    this.status = rule.to;
    this.touch();
    this.emit({ type: 'stateChanged', status: rule.to, previous });
  }

  // ── Context mutations ─────────────────────────────────────────

  setScene(scene: string, mood: string): void {
    this.assertMutable();
    this.scene = scene;
    this.mood = mood;
    this.touch();
    this.emit({ type: 'sceneChanged', scene, mood });
  }

  appendTranscriptLine(line: TranscriptLine): void {
    this.assertMutable();
    this.history.push(line);
    if (this.history.length > this.historyLimit) {
      this.history = this.history.slice(this.history.length - this.historyLimit);
    }
    this.touch();
    this.emit({ type: 'transcriptAppended', line });
  }

  setActiveMusic(music: ActiveMusic | null): void {
    this.assertMutable();
    this.activeMusic = music;
    this.touch();
    this.emit({ type: 'musicChanged', music });
  }

  setActiveImage(image: ActiveImage | null): void {
    this.assertMutable();
    this.activeImage = image;
    this.touch();
    this.emit({ type: 'imageChanged', image });
  }

  /** Scene/transcript/music/image can only change while a session is active or paused. */
  private assertMutable(): void {
    if (this.status !== 'active' && this.status !== 'paused') {
      throw new Error(
        `Cannot update context while session status is "${this.status}" — a session must be started first.`,
      );
    }
  }

  // ── Reads ────────────────────────────────────────────────────

  getSnapshot(): ContextSnapshot {
    return {
      status: this.status,
      sessionId: this.sessionId,
      scene: this.scene,
      mood: this.mood,
      history: [...this.history],
      activeMusic: this.activeMusic,
      activeImage: this.activeImage,
      updatedAt: this.updatedAt,
    };
  }

  // ── Events ───────────────────────────────────────────────────

  /** Subscribe to context events. Returns an unsubscribe function. */
  onEvent(listener: ContextEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ContextEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }
}
