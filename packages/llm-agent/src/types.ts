import { z } from 'zod';
import type { TranscriptLine } from '@rpg-assistant/shared-types';

// ── Input: what the prompt is built from ──────────────────────────────────

/**
 * Everything the LLM needs to decide on the next actions. Built from a
 * ContextManager snapshot (packages/context-manager) — this package has no
 * dependency on context-manager itself, to keep the module graph a DAG.
 */
export type AgentContext = {
  scene: string;
  mood: string;
  /** Most recent transcript lines, oldest first. */
  recentTranscript: Pick<TranscriptLine, 'displayName' | 'text' | 'isGM'>[];
  activeMusicTrack?: string;
  lastImageDescription?: string;
  /** Short summary of what's available in the asset library (music/images). */
  assetLibrarySummary?: string;
  /** TTRPG system in use, e.g. "D&D5e" — improves rule_help relevance. */
  gameSystem?: string;
  trigger: 'polling' | 'keyword' | 'manual';
};

// ── Output: validated against the LLM Agent Contract (shared-types) ───────

const AgentActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('music'), track: z.string(), fade_in: z.number().optional() }),
  z.object({ type: z.literal('image'), query: z.string(), source: z.enum(['library', 'generate']) }),
  z.object({
    type: z.literal('gm_tip'),
    text: z.string(),
    priority: z.enum(['low', 'normal', 'high']),
  }),
  z.object({ type: z.literal('rule_help'), topic: z.string(), system: z.string() }),
  z.object({ type: z.literal('none') }),
]);

/**
 * Mirrors the `AgentResponse` type in @rpg-assistant/shared-types — validated
 * at the boundary where we parse the LLM's raw JSON output.
 */
export const AgentResponseSchema = z.object({
  scene: z.string(),
  mood: z.string(),
  confidence: z.number().min(0).max(1),
  actions: z.array(AgentActionSchema),
  trigger: z.enum(['polling', 'keyword', 'manual']),
  timestamp: z.string(),
});
