import { describe, it, expect } from 'vitest';
import { buildPrompt } from './prompt';
import type { AgentContext } from './types';

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    scene: 'exploration',
    mood: 'mystérieux',
    recentTranscript: [
      { displayName: 'Alice', text: 'Vous entrez dans une taverne sombre.', isGM: true },
      { displayName: 'Bob', text: "Je cherche le barman du regard.", isGM: false },
    ],
    trigger: 'polling',
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('instructs the model to return JSON only, matching the AgentResponse schema', () => {
    const { system } = buildPrompt(makeContext());
    expect(system).toMatch(/JSON valide/i);
    expect(system).toContain('"scene"');
    expect(system).toContain('"actions"');
    expect(system).toContain('"trigger"');
  });

  it('includes scene, mood, and transcript lines with speaker labels in the user message', () => {
    const { user } = buildPrompt(makeContext());
    expect(user).toContain('exploration');
    expect(user).toContain('mystérieux');
    expect(user).toContain('[MJ] Alice: Vous entrez dans une taverne sombre.');
    expect(user).toContain('Bob: Je cherche le barman du regard.');
  });

  it('includes active music, image, game system and asset summary when provided', () => {
    const { user } = buildPrompt(
      makeContext({
        activeMusicTrack: 'forest_mystery',
        lastImageDescription: 'ruines dans une forêt sombre',
        gameSystem: 'D&D5e',
        assetLibrarySummary: '12 pistes, 30 images',
      }),
    );
    expect(user).toContain('forest_mystery');
    expect(user).toContain('ruines dans une forêt sombre');
    expect(user).toContain('D&D5e');
    expect(user).toContain('12 pistes, 30 images');
  });

  it('falls back to placeholder text for missing optional fields', () => {
    const { user } = buildPrompt(makeContext({ recentTranscript: [] }));
    expect(user).toContain('(aucune)');
    expect(user).toContain('(non précisé)');
  });

  it('reflects the trigger type', () => {
    const { user } = buildPrompt(makeContext({ trigger: 'keyword' }));
    expect(user).toContain('Déclencheur : keyword');
  });
});
