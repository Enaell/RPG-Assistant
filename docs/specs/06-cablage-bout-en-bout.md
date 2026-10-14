# Câblage bout-en-bout — De la session Discord à l'action IA automatique

**Statut** : 📝 Planifié (non implémenté)
**Partie(s) concernée(s)** : `apps/discord-bot`, `packages/context-manager`, `packages/llm-agent`, `apps/orchestrator`
**Spec(s) liée(s)** : [01 — Bot Discord](01-bot-discord.md), [02 — Pipeline IA](02-pipeline-ia.md), [03 — Orchestrateur](03-orchestrateur.md)

> Cette spec est volontairement écrite **avant** le code : c'est la pièce qui manque pour que la Phase 1 soit fonctionnellement complète (voir [00 — Vue d'ensemble](00-vue-ensemble.md)). Elle sert de base pour la prochaine itération de développement.

## Objectif

Faire en sorte qu'une session Discord réellement jouée déclenche, sans intervention manuelle, le pipeline IA complet (transcription → contexte → décision → dispatch), pour que le dashboard MJ reflète la partie en cours en quasi-temps réel.

## Acteurs

- **Bot Discord** : source du contexte (transcription, session active).
- **Gestionnaire de contexte**, **Agent IA**, **Orchestrateur** : déjà spécifiés individuellement ([02](02-pipeline-ia.md), [03](03-orchestrateur.md)).

## Comportement fonctionnel attendu

### Déclencheur en scope pour cette spec : le polling ambiant

Pendant qu'une session est `ACTIVE`, à intervalle régulier (15 secondes par défaut), le contexte courant de la session (scène/ambiance connues, historique récent de transcript, musique/image actives) est envoyé à l'agent IA, et sa réponse est transmise à l'orchestrateur local.

> Les déclencheurs sur mots-clés et les commandes manuelles `/scene` font partie de la vision long terme (ADR-004) mais sont explicitement **Phase 2** — ils feront l'objet d'une spec séparée le moment venu. Cette spec-ci ne couvre que le polling ambiant, suffisant pour sortir la Phase 1 du statut « briques non reliées ».

### Scénario nominal

1. Le MJ lance `/session start` ; le bot capte l'audio et alimente le contexte de session au fil des répliques transcrites.
2. Toutes les 15 secondes pendant que la session est active, le contexte courant est envoyé à l'agent IA.
3. La décision renvoyée (actions musique/image/conseil/règle) est transmise à l'orchestrateur local.
4. Le dashboard MJ, qui interroge déjà l'orchestrateur, reflète ce changement sans action supplémentaire du MJ.

### Scénario d'échec

Si l'agent IA ou l'orchestrateur est indisponible (timeout, erreur réseau, clé API invalide) au moment d'un cycle de polling :
- la capture audio en cours **n'est jamais interrompue** ;
- l'échec est journalisé et comptabilisé (sur le même principe que le compteur d'échecs de dispatch déjà existant pour l'audio en direct, visible dans `/session status`) ;
- le cycle de polling suivant retente normalement, sans accumulation d'appels en retard.

## Règles métier / contraintes

- **Respect strict des frontières de modules** : `apps/discord-bot` ne peut pas importer `apps/orchestrator`. La communication se fait uniquement via l'API HTTP locale de l'orchestrateur (`POST /actions`), jamais par appel de fonction direct.
- **Jamais d'appel IA par micro-segment** : le polling s'appuie sur le contexte accumulé par `packages/context-manager`, pas sur chaque réplique brute.
- **Aucun blocage de la capture audio** en cas d'échec de cette chaîne — cohérent avec la règle déjà en place pour `dispatchAudioSegment()`.
- Une session qui passe à `ENDED` (via `/session stop`) arrête également ce polling — pas d'appel résiduel après la fin de la session.

## Contrat de données

Reprend tel quel le contrat `AgentResponse` déjà défini dans [02 — Pipeline IA](02-pipeline-ia.md) ; aucune extension de ce contrat n'est nécessaire pour cette spec.

## Hors périmètre

- Déclenchement sur mots-clés détectés dans la transcription (Phase 2, spec à écrire séparément).
- Commandes manuelles `/scene`, `/mood` (Phase 2).
- Intégration OBS, lecture audio réelle sur Discord (Phase 2/3) — l'orchestrateur continue de dispatcher « logiquement » comme décrit dans la spec 03.

## Critères d'acceptation

- [ ] Une session démarrée via `/session start` déclenche, après ~15s d'activité, un appel réel à l'agent IA avec le contexte courant de cette session.
- [ ] La réponse validée de l'agent IA est transmise à `POST /actions` sur l'orchestrateur local.
- [ ] Un échec à n'importe quelle étape de cette chaîne est catché, journalisé, comptabilisé, et n'interrompt jamais la session en cours.
- [ ] Le compteur d'échecs de ce polling est visible via `/session status`, sur le même principe que le compteur existant pour l'audio en direct.
- [ ] Un test d'intégration couvre le scénario nominal et au moins un cas d'échec de la chaîne.
- [ ] Le polling s'arrête proprement quand la session passe à `ENDED`.

## Pour aller plus loin (technique)

Cette tâche touche plusieurs packages à la fois — l'agent `rpg-lead` (voir [copilot-instructions.md](../../.github/copilot-instructions.md)) est le point d'entrée recommandé pour la découper et déléguer aux agents `discord-bot-dev`, `ai-pipeline-dev` et `orchestrator-dev`.
