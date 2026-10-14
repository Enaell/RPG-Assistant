# Documentation fonctionnelle — RPG-Assistant

Ce dossier contient les **spécifications fonctionnelles** du projet : ce que chaque partie fait, pour qui, selon quelles règles — indépendamment de son implémentation technique.

Ce n'est **pas un doublon** des autres docs du repo :

| Document | Répond à |
|---|---|
| [README.md](../../README.md) | « Comment j'installe et je lance le projet ? » (quickstart, stack, Docker) |
| [.github/copilot-instructions.md](../../.github/copilot-instructions.md) | « Quelles conventions de code l'IA doit-elle respecter ? » |
| [.github/instructions/*.instructions.md](../../.github/instructions/) | Détail technique par dossier, auto-chargé par Copilot en édition |
| **docs/specs/* (ici)** | « Que fait fonctionnellement cette partie du projet, pour qui, selon quelles règles ? » |

## Index des specs

| # | Fichier | Partie(s) couverte(s) | Statut |
|---|---|---|---|
| 00 | [Vue d'ensemble](00-vue-ensemble.md) | Vision produit, parcours MJ, glossaire | ✅ Implémenté |
| 01 | [Bot Discord](01-bot-discord.md) | `apps/discord-bot` | ✅ Implémenté (Phase 1) |
| 02 | [Pipeline IA](02-pipeline-ia.md) | `packages/stt-client`, `packages/llm-agent`, `packages/context-manager` | 🧩 Implémenté isolément, non câblé |
| 03 | [Orchestrateur](03-orchestrateur.md) | `apps/orchestrator` | 🧩 Implémenté, pas encore appelé en conditions réelles |
| 04 | [Dashboard MJ](04-dashboard-mj.md) | `apps/gm-dashboard` | ✅ Implémenté (autonome) |
| 05 | [Persistance des données](05-persistance-donnees.md) | `packages/db` | ✅ Implémenté |
| 06 | [Câblage bout-en-bout](06-cablage-bout-en-bout.md) | discord-bot → context-manager → llm-agent → orchestrator | 📝 Planifié |

### Légende des statuts

- ✅ **Implémenté** — le comportement décrit existe et est testé/utilisable aujourd'hui.
- 🧩 **Partiel** — la brique technique existe mais le comportement fonctionnel complet décrit n'est pas encore observable de bout en bout.
- 📝 **Planifié** — spec écrite en amont du développement, rien n'est encore codé. C'est la spec qui doit guider l'implémentation, pas l'inverse.

## Comment utiliser ce dossier pour continuer le développement

1. **Avant de coder une nouvelle fonctionnalité ou une évolution** : écris ou mets à jour la spec correspondante ici (nouveau fichier si nouvelle partie, sinon section « Évolutions envisagées » du fichier existant).
2. **Pendant le développement** : utilise la spec comme source de vérité fonctionnelle, et les fichiers `.github/instructions/*.instructions.md` / agents `.agent.md` (voir [copilot-instructions.md](../../.github/copilot-instructions.md)) comme guide technique d'implémentation.
3. **Une fois implémenté** : met à jour le statut de la spec (🧩 ou 📝 → ✅) et ajoute les critères d'acceptation vérifiés.
4. Les specs des phases 2/3 non encore rédigées peuvent être ajoutées au fur et à mesure selon ce même modèle plutôt que d'être toutes écrites à l'avance.

## Modèle pour une nouvelle spec

```markdown
# Titre de la fonctionnalité

**Statut** : 📝 Planifié
**Partie(s) concernée(s)** : `apps/...` / `packages/...`
**Spec(s) liée(s)** : ...

## Objectif

Une à deux phrases : quel problème utilisateur ça résout, pour qui.

## Acteurs

Qui déclenche/consomme ce comportement (MJ, Joueur, Bot, Orchestrateur, Dashboard…).

## Comportement fonctionnel

Décrire des scénarios concrets (étant donné / quand / alors), pas du code.

## Règles métier / contraintes

Ce qui doit toujours être vrai (ex. : jamais d'audio brut stocké, jamais de retry sur une clé API invalide).

## Contrat de données

Si pertinent : forme des données échangées (sans détail d'implémentation).

## Hors périmètre

Ce que cette spec ne couvre volontairement pas (et où c'est traité, si ça l'est).

## Critères d'acceptation

Liste vérifiable permettant de dire « c'est fait ».

## Pour aller plus loin (technique)

Liens vers les fichiers `.instructions.md` / agents concernés.
```
