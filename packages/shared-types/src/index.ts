// ============================================================
// Audio Capture
// ============================================================

/**
 * A complete audio utterance from a single speaker, ready for STT processing.
 *
 * IMPORTANT: Per our privacy policy, audio buffers must be transcribed and
 * immediately discarded — never persist raw audio to disk or external storage.
 */
export type AudioSegment = {
  /** Unique identifier for this audio segment (UUID v4) */
  segmentId: string;
  /** Parent session this segment belongs to */
  sessionId: string;
  /** Discord user Snowflake ID */
  userId: string;
  /** Discord username, e.g. "john_doe" */
  username: string;
  /** Guild display name (server nickname, or username if none) */
  displayName: string;
  /** True if this user is the designated Game Master for this session */
  isGM: boolean;
  /** When the user started speaking */
  startTimestamp: Date;
  /** When the user stopped speaking */
  endTimestamp: Date;
  /** Actual speech duration in milliseconds (excludes trailing silence) */
  durationMs: number;
  /**
   * WAV-encoded audio buffer at 16 kHz mono 16-bit PCM.
   * Optimised for STT input (Voxtral / Whisper).
   */
  wavBuffer: Buffer;
};

// ============================================================
// Session State
// ============================================================

export type SessionStatus = 'idle' | 'active' | 'paused' | 'ended';

export type Session = {
  /** Unique session identifier (UUID v4) */
  id: string;
  /** Discord guild (server) Snowflake ID */
  guildId: string;
  /** Voice channel Snowflake ID being captured */
  channelId: string;
  /** ISO 8601 start timestamp */
  startedAt: string;
  /** ISO 8601 end timestamp — undefined while session is active */
  endedAt?: string;
  status: SessionStatus;
  /** Discord user Snowflake IDs of Game Masters for this session */
  gmUserIds: string[];
};

// ============================================================
// Transcription
// ============================================================

/**
 * A single transcribed utterance, produced by the STT client from an AudioSegment.
 */
export type TranscriptLine = {
  /** Unique identifier (UUID v4) */
  id: string;
  sessionId: string;
  speakerId: string;
  speakerName: string;
  displayName: string;
  /** Transcribed text */
  text: string;
  /** ISO 8601 */
  startTimestamp: string;
  /** ISO 8601 */
  endTimestamp: string;
  isGM: boolean;
};

// ============================================================
// LLM Agent Contract
// ============================================================

export type AgentAction =
  | { type: 'music'; track: string; fade_in?: number; }
  | { type: 'image'; query: string; source: 'library' | 'generate'; }
  | { type: 'gm_tip'; text: string; priority: 'low' | 'normal' | 'high'; }
  | { type: 'rule_help'; topic: string; system: string; }
  | { type: 'none'; };

export type AgentResponse = {
  scene: string;
  mood: string;
  /** Confidence score 0-1 */
  confidence: number;
  actions: AgentAction[];
  trigger: 'polling' | 'keyword' | 'manual';
  /** ISO 8601 */
  timestamp: string;
};

// ============================================================
// Result<T, E> — error handling without throwing
// ============================================================

export type Ok<T> = { ok: true; value: T; };
export type Err<E> = { ok: false; error: E; };
export type Result<T, E = Error> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });
