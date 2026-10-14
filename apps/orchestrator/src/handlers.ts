import type { AgentAction } from '@rpg-assistant/shared-types';

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

export function createInitialState(now: () => Date = () => new Date()): OrchestratorState {
  return {
    scene: '',
    mood: '',
    activeMusic: null,
    activeImage: null,
    lastGmTip: null,
    lastRuleHelp: null,
    lastTrigger: null,
    lastConfidence: null,
    updatedAt: now().toISOString(),
  };
}

export type HandlerResult<T> = { state: T | null; applied: boolean; reason?: 'duplicate'; };

/** True if `dispatchedAt` is still within `windowMs` of `now`. */
function withinWindow(dispatchedAt: string, now: Date, windowMs: number): boolean {
  return now.getTime() - new Date(dispatchedAt).getTime() < windowMs;
}

// ── Per-type dispatch handlers ────────────────────────────────────────────
// Each handler decides whether an incoming action is a no-op duplicate of the
// currently active one (same payload, still within the dedup window) or
// should actually replace the current state.

export function handleMusic(
  current: ActiveMusic | null,
  action: Extract<AgentAction, { type: 'music'; }>,
  now: Date,
  dedupWindowMs: number,
): HandlerResult<ActiveMusic> {
  if (current && current.track === action.track && withinWindow(current.dispatchedAt, now, dedupWindowMs)) {
    return { state: current, applied: false, reason: 'duplicate' };
  }
  return {
    state: { track: action.track, fadeIn: action.fade_in, dispatchedAt: now.toISOString() },
    applied: true,
  };
}

export function handleImage(
  current: ActiveImage | null,
  action: Extract<AgentAction, { type: 'image'; }>,
  now: Date,
  dedupWindowMs: number,
): HandlerResult<ActiveImage> {
  if (
    current &&
    current.query === action.query &&
    current.source === action.source &&
    withinWindow(current.dispatchedAt, now, dedupWindowMs)
  ) {
    return { state: current, applied: false, reason: 'duplicate' };
  }
  return {
    state: { query: action.query, source: action.source, dispatchedAt: now.toISOString() },
    applied: true,
  };
}

export function handleGmTip(
  current: LastGmTip | null,
  action: Extract<AgentAction, { type: 'gm_tip'; }>,
  now: Date,
  dedupWindowMs: number,
): HandlerResult<LastGmTip> {
  if (current && current.text === action.text && withinWindow(current.dispatchedAt, now, dedupWindowMs)) {
    return { state: current, applied: false, reason: 'duplicate' };
  }
  return {
    state: { text: action.text, priority: action.priority, dispatchedAt: now.toISOString() },
    applied: true,
  };
}

export function handleRuleHelp(
  current: LastRuleHelp | null,
  action: Extract<AgentAction, { type: 'rule_help'; }>,
  now: Date,
  dedupWindowMs: number,
): HandlerResult<LastRuleHelp> {
  if (
    current &&
    current.topic === action.topic &&
    current.system === action.system &&
    withinWindow(current.dispatchedAt, now, dedupWindowMs)
  ) {
    return { state: current, applied: false, reason: 'duplicate' };
  }
  return {
    state: { topic: action.topic, system: action.system, dispatchedAt: now.toISOString() },
    applied: true,
  };
}
