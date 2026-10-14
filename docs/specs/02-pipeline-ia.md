# Pipeline IA — Transcription, contexte, décision

**Statut** : 🧩 Implémenté isolément, non câblé en conditions réelles
**Partie(s) concernée(s)** : `packages/stt-client`, `packages/context-manager`, `packages/llm-agent`
**Spec(s) liée(s)** : [01 — Bot Discord](01-bot-discord.md), [03 — Orchestrateur](03-orchestrateur.md), [06 — Câblage bout-en-bout](06-cablage-bout-en-bout.md)

## Objectif

Transformer la parole captée pendant la session en décisions concrètes d'ambiance (musique, image, conseil MJ, aide de règles), en s'appuyant sur le contexte narratif accumulé plutôt que sur une seule réplique isolée.

## Acteurs

- **Service de transcription (STT)** : convertit l'audio en texte.
- **Gestionnaire de contexte** : mémorise l'état courant de la session.
- **Agent IA** : décide des actions à partir du contexte.

## Comportement fonctionnel

### Transcription (STT)

Chaque segment audio court (une réplique délimitée par un silence) est envoyé au service de transcription et renvoie un texte. Les échecs réseau ou de quota sont retentés automatiquement (avec un temps d'attente croissant) avant d'être comptés comme échecs définitifs — aucune réplique n'est silencieusement perdue sans trace.

### Contexte de session

Le contexte suit, pour une session donnée :
- l'état courant : `IDLE → ACTIVE → PAUSED → ACTIVE → ENDED` (`ENDED` est définitif — une nouvelle session repart de zéro) ;
- la scène et l'ambiance courantes ;
- un historique borné des dernières répliques (pas tout l'historique de la séance, pour garder le contexte envoyé à l'IA pertinent et compact) ;
- la musique et l'image actuellement actives.

Chaque changement (nouvelle réplique, changement de scène, changement de musique/image, changement d'état) est signalé par un événement, consommable par la suite de la chaîne.

### Décision de l'agent IA

À partir du contexte courant, l'agent IA produit une réponse structurée :

```json
{
  "scene": "exploration",
  "mood": "mystérieux",
  "confidence": 0.87,
  "actions": [
    { "type": "music", "track": "forest_mystery", "fade_in": 3 },
    { "type": "image", "query": "ruines dans une forêt sombre", "source": "library" },
    { "type": "gm_tip", "text": "Préparer un jet de Perception. DC 14.", "priority": "high" },
    { "type": "rule_help", "topic": "stealth", "system": "D&D5e" }
  ],
  "trigger": "polling",
  "timestamp": "2025-10-15T20:34:11Z"
}
```

Les types d'action possibles sont : `music`, `image`, `gm_tip`, `rule_help`, ou `none` (aucune action pertinente pour l'instant).

## Règles métier / contraintes

- **Jamais un appel IA par micro-segment audio** : on attend une frontière de phrase ou un silence avant de considérer qu'il y a quelque chose à analyser — sinon le coût et la latence explosent pour rien.
- **Pas de modèle de transcription temps réel/WebSocket utilisé ici** : uniquement l'API par lot (batch), un segment = un appel HTTP.
- **Aucun fallback silencieux** si la réponse de l'agent IA n'est pas un JSON valide ou ne respecte pas le contrat attendu : c'est signalé explicitement à l'appelant (ignorer ce cycle, alerter le MJ…), jamais masqué.
- **Pas de nouvelle tentative automatique** si l'erreur vient d'une clé API invalide ou si le délai d'attente est déjà dépassé — seules les erreurs réseau/serveur temporaires sont retentées.
- Une session terminée (`ENDED`) ne peut pas reprendre : toute nouvelle session démarre un nouveau contexte.

## Contrat de données

Voir le JSON ci-dessus : c'est le contrat d'échange entre l'agent IA et l'orchestrateur (type `AgentResponse`). Le champ `trigger` indique toujours pourquoi la décision a été prise (`polling`, `keyword`, `manual`), ce qui permet au dashboard/aux logs de distinguer une réaction automatique d'une réaction provoquée.

## Hors périmètre

- Déclenchement automatique réel de ce pipeline pendant une session Discord : voir [06 — Câblage bout-en-bout](06-cablage-bout-en-bout.md), c'est la pièce manquante.
- Détection de mots-clés dans la transcription : Phase 2.
- Exécution locale du modèle de langage (Ollama) ou du STT (Whisper local) : Phase 3, le contrat fonctionnel ci-dessus reste identique quel que soit le backend.

## Critères d'acceptation

- [x] Un texte transcrit peut échouer sans faire planter le reste du traitement (retry géré).
- [x] Le contexte de session reflète toujours la dernière scène/ambiance/musique/image connue.
- [x] Une réponse d'agent IA invalide est explicitement signalée, jamais ignorée en silence.
- [ ] Une session réelle déclenche effectivement ce pipeline sans intervention manuelle (→ spec 06).

## Pour aller plus loin (technique)

[.github/instructions/ai-pipeline.instructions.md](../../.github/instructions/ai-pipeline.instructions.md) · agent `ai-pipeline-dev`
