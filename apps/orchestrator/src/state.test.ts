import { describe, it, expect } from 'vitest';
import type { AgentResponse } from '@rpg-assistant/shared-types';
import { applyAgentResponse, createInitialState } from './state';

function makeResponse(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    scene: 'exploration',
    mood: 'mystérieux',
    confidence: 0.8,
    actions: [],
    trigger: 'polling',
    timestamp: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

const FIXED_NOW = new Date('2026-01-01T10:00:00.000Z');

describe('applyAgentResponse', () => {
  it('always updates scene, mood, trigger and confidence', () => {
    const state = createInitialState(() => FIXED_NOW);
    const { state: next } = applyAgentResponse(state, makeResponse({ scene: 'combat', mood: 'tendu' }));
    expect(next.scene).toBe('combat');
    expect(next.mood).toBe('tendu');
    expect(next.lastTrigger).toBe('polling');
    expect(next.lastConfidence).toBe(0.8);
  });

  it('dispatches a music action and marks it applied', () => {
    const state = createInitialState(() => FIXED_NOW);
    const { state: next, outcomes } = applyAgentResponse(
      state,
      makeResponse({ actions: [{ type: 'music', track: 'forest_mystery', fade_in: 3 }] }),
      { now: () => FIXED_NOW },
    );
    expect(next.activeMusic).toEqual({ track: 'forest_mystery', fadeIn: 3, dispatchedAt: FIXED_NOW.toISOString() });
    expect(outcomes[0]).toMatchObject({ applied: true });
  });

  it('skips a repeated identical music action within the dedup window', () => {
    let state = createInitialState(() => FIXED_NOW);
    const response = makeResponse({ actions: [{ type: 'music', track: 'forest_mystery' }] });

    ({ state } = applyAgentResponse(state, response, { now: () => FIXED_NOW, dedupWindowMs: 5_000 }));
    const secondCallTime = new Date(FIXED_NOW.getTime() + 1_000);
    const { state: next, outcomes } = applyAgentResponse(state, response, {
      now: () => secondCallTime,
      dedupWindowMs: 5_000,
    });

    expect(outcomes[0]).toMatchObject({ applied: false, reason: 'duplicate' });
    expect(next.activeMusic?.dispatchedAt).toBe(FIXED_NOW.toISOString()); // unchanged
  });

  it('re-applies the same music track once the dedup window has elapsed', () => {
    let state = createInitialState(() => FIXED_NOW);
    const response = makeResponse({ actions: [{ type: 'music', track: 'forest_mystery' }] });

    ({ state } = applyAgentResponse(state, response, { now: () => FIXED_NOW, dedupWindowMs: 1_000 }));
    const later = new Date(FIXED_NOW.getTime() + 2_000);
    const { state: next, outcomes } = applyAgentResponse(state, response, {
      now: () => later,
      dedupWindowMs: 1_000,
    });

    expect(outcomes[0]).toMatchObject({ applied: true });
    expect(next.activeMusic?.dispatchedAt).toBe(later.toISOString());
  });

  it('applies a different music track even within the dedup window', () => {
    let state = createInitialState(() => FIXED_NOW);
    ({ state } = applyAgentResponse(
      state,
      makeResponse({ actions: [{ type: 'music', track: 'forest_mystery' }] }),
      { now: () => FIXED_NOW },
    ));
    const { outcomes } = applyAgentResponse(
      state,
      makeResponse({ actions: [{ type: 'music', track: 'battle_theme' }] }),
      { now: () => FIXED_NOW },
    );
    expect(outcomes[0]).toMatchObject({ applied: true });
  });

  it('dispatches and de-duplicates image, gm_tip and rule_help actions independently', () => {
    let state = createInitialState(() => FIXED_NOW);
    const response = makeResponse({
      actions: [
        { type: 'image', query: 'dark ruins', source: 'library' },
        { type: 'gm_tip', text: 'Ask for a Perception check.', priority: 'high' },
        { type: 'rule_help', topic: 'stealth', system: 'D&D5e' },
      ],
    });

    const first = applyAgentResponse(state, response, { now: () => FIXED_NOW, dedupWindowMs: 5_000 });
    expect(first.outcomes.every((o) => o.applied)).toBe(true);
    state = first.state;

    const second = applyAgentResponse(state, response, {
      now: () => new Date(FIXED_NOW.getTime() + 1_000),
      dedupWindowMs: 5_000,
    });
    expect(second.outcomes.every((o) => o.reason === 'duplicate')).toBe(true);
  });

  it('treats a "none" action as a no-op without touching active music/image', () => {
    let state = createInitialState(() => FIXED_NOW);
    ({ state } = applyAgentResponse(
      state,
      makeResponse({ actions: [{ type: 'music', track: 'forest_mystery' }] }),
      { now: () => FIXED_NOW },
    ));

    const { state: next, outcomes } = applyAgentResponse(state, makeResponse({ actions: [{ type: 'none' }] }), {
      now: () => FIXED_NOW,
    });

    expect(outcomes[0]).toMatchObject({ applied: false });
    expect(next.activeMusic?.track).toBe('forest_mystery'); // untouched
  });
});
