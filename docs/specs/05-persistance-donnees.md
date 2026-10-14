# Persistance des données — Sessions et transcriptions

**Statut** : ✅ Implémenté
**Partie(s) concernée(s)** : `packages/db`
**Spec(s) liée(s)** : [01 — Bot Discord](01-bot-discord.md), [03 — Orchestrateur](03-orchestrateur.md)

## Objectif

Conserver ce qui est nécessaire pour retrouver, lister et retranscrire une séance passée (métadonnées de session, lignes de transcript texte) — et seulement ça : jamais l'audio brut.

## Acteurs

- **Bot Discord** : seul à écrire dans la base.
- **Orchestrateur** : lit seul (lecture seule) les lignes de transcript récentes pour le dashboard.

## Comportement fonctionnel

- Chaque session (du `/session start` au `/session stop`) est enregistrée avec ses métadonnées (identifiant, horodatage de début/fin).
- Chaque réplique transcrite (en direct ou après-coup via `/session transcribe`) est enregistrée avec : la session associée, l'horodatage, le locuteur, le texte, et — pour les transcriptions post-séance uniquement — le fichier audio source dont elle provient.
- Relancer une transcription post-séance sur une session déjà traitée ne recrée jamais de doublon : chaque ligne est liée de façon unique à son fichier source, donc un fichier déjà transcrit est reconnu et sauté.
- `/session list` et `/session status` s'appuient entièrement sur ces données pour afficher durée/nombre de lignes.

## Règles métier / contraintes

- **Aucun audio brut n'est jamais stocké en base** — uniquement du texte et des métadonnées. L'audio, quand il existe temporairement (mode `local`), reste des fichiers `.wav` sur disque, hors de cette base.
- Un seul processus écrit à la fois (le bot), un seul processus lit en parallèle sans écrire (l'orchestrateur) — pas de scénario multi-écrivain à supporter.
- Une ligne de transcript issue d'un flux en direct (sans fichier source) et une ligne issue d'une transcription post-séance (avec fichier source) peuvent coexister pour la même session sans se dupliquer ni se percuter.

## Hors périmètre

- Chiffrement au repos de la base : non couvert, l'hypothèse est un poste MJ de confiance.
- Purge/rétention automatique après X jours : non spécifiée à ce stade — à définir si le besoin se présente (ajouter une spec dédiée le cas échéant).
- Sauvegarde/réplication : hors périmètre, usage mono-poste.

## Critères d'acceptation

- [x] Une session et ses répliques sont retrouvables via `/session list`/`/session status` après redémarrage du bot.
- [x] Relancer `/session transcribe` sur une session déjà transcrite ne duplique aucune ligne.
- [x] Aucun champ ou table ne contient de données audio brutes.

## Pour aller plus loin (technique)

[.github/instructions/db.instructions.md](../../.github/instructions/db.instructions.md) · agent `db-dev`
