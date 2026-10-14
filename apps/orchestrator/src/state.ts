import type { AgentAction, AgentResponse } from '@rpg-assistant/shared-types';
import {
  handleGmTip,
  handleImage,
  handleMusic,
  handleRuleHelp,
  type OrchestratorState,
} from './handlers.js';
import { log } from './logger.js';

export { createInitialState, type OrchestratorState } from './handlers.js';

export type DispatchOutcome = { action: AgentAction; applied: boolean; reason?: 'duplicate'; };

export type DispatchResult = {
  state: OrchestratorState;
  outcomes: DispatchOutcome[];
};

export type ApplyOptions = {
  /** Actions of the same type+payload within this window are treated as duplicates. Default 4000ms. */
  dedupWindowMs?: number;
  now?: () => Date;
};

const DEFAULT_DEDUP_WINDOW_MS = 4_000;

/**
 * Pure reducer: applies a validated AgentResponse to the current orchestrator
 * state, routing each action to its type-specific handler and de-duplicating
 * repeats. Kept free of HTTP/Express so it's trivial to unit test.
 */
export function applyAgentResponse(
  state: OrchestratorState,
  response: AgentResponse,
  opts: ApplyOptions = {},
): DispatchResult {
  const dedupWindowMs = opts.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
  const now = (opts.now ?? (() => new Date()))();

  let next: OrchestratorState = {
    ...state,
    scene: response.scene,
    mood: response.mood,
    lastTrigger: response.trigger,
    lastConfidence: response.confidence,
    updatedAt: now.toISOString(),
  };

  const outcomes: DispatchOutcome[] = [];

  for (const action of response.actions) {
    if (action.type === 'none') {
      outcomes.push({ action, applied: false });
      continue;
    }

    if (action.type === 'music') {
      const result = handleMusic(next.activeMusic, action, now, dedupWindowMs);
      next = { ...next, activeMusic: result.state };
      outcomes.push({ action, applied: result.applied, reason: result.reason });
    } else if (action.type === 'image') {
      const result = handleImage(next.activeImage, action, now, dedupWindowMs);
      next = { ...next, activeImage: result.state };
      outcomes.push({ action, applied: result.applied, reason: result.reason });
    } else if (action.type === 'gm_tip') {
      const result = handleGmTip(next.lastGmTip, action, now, dedupWindowMs);
      next = { ...next, lastGmTip: result.state };
      outcomes.push({ action, applied: result.applied, reason: result.reason });
    } else {
      const result = handleRuleHelp(next.lastRuleHelp, action, now, dedupWindowMs);
      next = { ...next, lastRuleHelp: result.state };
      outcomes.push({ action, applied: result.applied, reason: result.reason });
    }

    const outcome = outcomes[outcomes.length - 1]!;
    if (outcome.reason === 'duplicate') {
      log('action.skipped_duplicate', { type: action.type });
    } else if (outcome.applied) {
      log('action.dispatched', { type: action.type });
    }
  }

  return { state: next, outcomes };
}
