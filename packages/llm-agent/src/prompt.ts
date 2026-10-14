import type { AgentContext } from './types.js';

const RESPONSE_SCHEMA_DESCRIPTION = `{
  "scene": string,
  "mood": string,
  "confidence": number between 0 and 1,
  "actions": array of 0-3 objects, each one of:
    { "type": "music", "track": string, "fade_in"?: number }
    { "type": "image", "query": string, "source": "library" | "generate" }
    { "type": "gm_tip", "text": string, "priority": "low" | "normal" | "high" }
    { "type": "rule_help", "topic": string, "system": string }
    { "type": "none" }
  "trigger": "polling" | "keyword" | "manual",
  "timestamp": ISO 8601 string
}`;

/**
 * Builds the system + user messages sent to the LLM. Keeping this pure and
 * side-effect free makes it trivial to unit test without any network mocking.
 */
export function buildPrompt(context: AgentContext): { system: string; user: string; } {
  const system =
    'Tu es un assistant de Maître du Jeu (MJ) pour une session de jeu de rôle sur table. ' +
    "Ton rôle est de réagir à la narration en cours et de proposer des actions utiles : " +
    'musique d\'ambiance, image de scène, conseil discret au MJ, ou aide de règles. ' +
    'Réponds UNIQUEMENT avec un objet JSON valide respectant strictement ce schéma, sans texte ' +
    `avant ou après, sans balises markdown :\n${RESPONSE_SCHEMA_DESCRIPTION}\n` +
    'Ne propose une action que si elle apporte une réelle valeur à ce moment précis — ' +
    'préfère "actions": [{ "type": "none" }] plutôt que de répéter une action déjà active sans raison.';

  const transcriptLines = context.recentTranscript
    .map((l) => `${l.isGM ? '[MJ] ' : ''}${l.displayName}: ${l.text}`)
    .join('\n');

  const user = [
    `Scène actuelle : ${context.scene || '(inconnue)'}`,
    `Ambiance actuelle : ${context.mood || '(inconnue)'}`,
    `Musique active : ${context.activeMusicTrack ?? '(aucune)'}`,
    `Dernière image affichée : ${context.lastImageDescription ?? '(aucune)'}`,
    `Système de jeu : ${context.gameSystem ?? '(non précisé)'}`,
    `Bibliothèque d'assets disponible : ${context.assetLibrarySummary ?? '(non précisée)'}`,
    `Déclencheur : ${context.trigger}`,
    '',
    'Dernières répliques transcrites :',
    transcriptLines || '(aucune)',
  ].join('\n');

  return { system, user };
}
