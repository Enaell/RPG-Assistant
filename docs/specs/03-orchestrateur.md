# Orchestrateur — Dispatch des actions IA

**Statut** : 🧩 Implémenté, pas encore appelé en conditions réelles
**Partie(s) concernée(s)** : `apps/orchestrator`
**Spec(s) liée(s)** : [02 — Pipeline IA](02-pipeline-ia.md), [04 — Dashboard MJ](04-dashboard-mj.md), [06 — Câblage bout-en-bout](06-cablage-bout-en-bout.md)

## Objectif

Centraliser, en un seul endroit interrogeable, l'état « à afficher/jouer actuellement » d'une session (musique active, image active, dernier conseil MJ, dernière aide de règles), à partir des décisions produites par l'agent IA — pour que le dashboard (et plus tard OBS, un lecteur audio…) n'ait qu'une seule source à consulter.

## Acteurs

- **Agent IA** : envoie ses décisions.
- **Orchestrateur** : reçoit, filtre les doublons, maintient l'état.
- **Dashboard MJ** (et futurs consommateurs : OBS, bot audio) : lisent l'état courant.

## Comportement fonctionnel

### Réception d'une décision

Quand l'agent IA produit une réponse, elle est soumise à l'orchestrateur. Chaque action qu'elle contient (musique, image, conseil, aide de règles) est traitée indépendamment : une décision peut par exemple changer la musique sans rien dire sur l'image.

Un type d'action non reconnu est rejeté explicitement plutôt que silencieusement ignoré.

### Anti-doublon (déduplication)

Si la même action (même type, même contenu) est reçue plusieurs fois dans une courte fenêtre de temps — ce qui arrive naturellement avec un polling ambiant répété — elle n'est appliquée/affichée qu'une fois. Chaque type d'action (musique, image, conseil, règle) a sa propre fenêtre anti-doublon : changer la musique n'empêche pas un nouveau conseil MJ d'apparaître dans le même intervalle.

### Consultation de l'état

À tout moment, l'état courant complet (scène, ambiance, musique/image actives, dernier conseil, dernière aide de règles) peut être consulté — c'est ce que le dashboard interroge en continu.

### Consultation de la transcription récente

Les dernières lignes de transcription d'une session (texte brut, pas les décisions de l'agent) peuvent aussi être consultées séparément, pour afficher au MJ un rappel de ce qui vient d'être dit.

## Règles métier / contraintes

- **Jamais exposé au-delà de la machine du MJ** : cette API ne doit être accessible que localement, jamais depuis l'extérieur.
- Le dispatch en Phase 1 est **purement logique** (mise à jour d'un état + logs) : pas encore de lecture audio réelle sur Discord ni d'appel OBS — ces intégrations arriveront en Phase 2/3, le contrat fonctionnel décrit ici ne change pas pour autant.
- La consultation de la transcription récente est une fonctionnalité **séparée** de la réception de décisions IA (elle ne transite pas par le même contrat de données) — elle sert uniquement à donner un contexte textuel brut au MJ.

## Hors périmètre

- Déclenchement réel à partir d'une session Discord en cours : voir spec 06, rien n'appelle encore cette brique automatiquement.
- Lecture audio Discord ou pilotage OBS réels : Phase 2/3.
- Authentification/autorisation : non prévue tant que l'accès reste strictement local.

## Critères d'acceptation

- [x] Deux décisions identiques reçues rapprochées dans le temps ne produisent qu'un seul changement d'état visible.
- [x] Un type d'action inconnu est rejeté avec une erreur explicite.
- [x] L'état courant et la transcription récente sont consultables indépendamment l'un de l'autre.
- [ ] Une session Discord réelle alimente cet état automatiquement (→ spec 06).

## Pour aller plus loin (technique)

[.github/instructions/orchestrator.instructions.md](../../.github/instructions/orchestrator.instructions.md) · agent `orchestrator-dev`
