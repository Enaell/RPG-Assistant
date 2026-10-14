# Dashboard MJ — Interface de suivi en temps quasi-réel

**Statut** : ✅ Implémenté (autonome)
**Partie(s) concernée(s)** : `apps/gm-dashboard`
**Spec(s) liée(s)** : [03 — Orchestrateur](03-orchestrateur.md)

## Objectif

Donner au MJ une vue claire et continue de ce que l'agent IA décide pendant la partie (scène, ambiance, conseil, image, musique) et de la transcription récente, sur un deuxième écran ou en incrustation de stream, sans qu'il ait à interagir avec un terminal ou Discord pour le consulter.

## Acteurs

- **MJ** : consulte passivement l'écran.
- **Dashboard** : interroge l'orchestrateur et affiche son état.

## Comportement fonctionnel

- L'interface interroge l'orchestrateur à intervalle régulier (toutes les 3 secondes) pour rafraîchir :
  - la scène et l'ambiance courantes ;
  - le dernier conseil MJ reçu ;
  - l'image active ;
  - la musique active ;
  - les dernières lignes de transcription de la session ;
  - le statut de connexion à l'orchestrateur (connecté / perdu).
- L'identifiant de session à afficher est saisi manuellement par le MJ — il n'y a pas (encore) de détection automatique de « la session en cours ».
- En cas de perte de connexion à l'orchestrateur, l'état affiché le signale clairement plutôt que de figer silencieusement sur la dernière valeur connue.

## Règles métier / contraintes

- **Lecture seule** : le dashboard ne déclenche jamais d'action lui-même en Phase 1 (pas de bouton « rejouer », « changer de musique », etc.) — il reflète uniquement l'état décidé par l'agent IA.
- Ne communique **qu'avec l'orchestrateur local**, jamais directement avec Discord, la base SQLite, ou un service externe.

## Hors périmètre

- Détection automatique de la session active (pas d'endpoint dédié côté orchestrateur pour l'instant).
- Actions manuelles depuis le dashboard (forcer une musique, valider une suggestion…) : non prévu en Phase 1.
- Authentification : l'accès réseau local suffit tant que l'orchestrateur n'est pas exposé publiquement.

## Critères d'acceptation

- [x] Le MJ voit la scène/ambiance/conseil/image/musique se mettre à jour sans recharger la page.
- [x] Une perte de connexion à l'orchestrateur est visible à l'écran.
- [x] La transcription récente de la session est consultable depuis le dashboard.

## Pour aller plus loin (technique)

[.github/instructions/dashboard.instructions.md](../../.github/instructions/dashboard.instructions.md) · agent `dashboard-dev`
