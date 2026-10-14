# Bot Discord — Capture vocale et cycle de vie de session

**Statut** : ✅ Implémenté (Phase 1)
**Partie(s) concernée(s)** : `apps/discord-bot`
**Spec(s) liée(s)** : [02 — Pipeline IA](02-pipeline-ia.md), [05 — Persistance des données](05-persistance-donnees.md)

## Objectif

Permettre au MJ de démarrer/arrêter une capture audio par participant dans un salon vocal Discord, dans le respect du consentement explicite, et de produire soit des fichiers audio exploitables plus tard, soit une transcription en direct.

## Acteurs

- **MJ** : déclenche les commandes `/session`.
- **Joueurs** : leur audio est capté séparément mais n'est pas prioritaire côté analyse.
- **Bot** : exécute la capture, la persistance, et la notice de consentement.

## Comportement fonctionnel

### Commandes disponibles

| Commande | Comportement |
|---|---|
| `/session start channel:#vocal gm:@alice` | Poste une notice de consentement dans le salon texte, rejoint le salon vocal indiqué, démarre la capture audio **par utilisateur** |
| `/session stop` | Arrête immédiatement toute capture, vide les buffers audio en mémoire, quitte le vocal |
| `/session status` | Affiche l'état de la session en cours (durée, nombre de répliques captées/transcrites, compteur d'échecs de dispatch) |
| `/session list` | Liste les 5 dernières sessions (ID, durée, nombre de lignes transcrites) |
| `/session transcribe [session-id:<id>]` | Transcrit après-coup les fichiers audio locaux d'une session et produit un export texte |

### Deux modes de sortie audio

- **Mode `local`** (développement) : chaque prise de parole est sauvegardée en fichier `.wav` horodaté sur disque, dans `recordings/<sessionId>/`. Rien n'est transcrit automatiquement ; il faut lancer `/session transcribe` après la séance.
- **Mode `stt`** : chaque réplique (segment court délimité par un silence) est envoyée à l'instant à l'API de transcription, et le texte apparaît en direct dans la console/la base de données. L'audio n'est jamais conservé dans ce mode.

### Transcription post-séance

`/session transcribe` relit les `.wav` d'une session dans l'ordre chronologique, les envoie un par un au service de transcription, et produit :
- des lignes enregistrées en base (une par réplique, avec horodatage et locuteur) ;
- un fichier `transcript.txt` lisible directement, dans le même dossier que les `.wav`.

Relancer la commande sur une session déjà (partiellement) transcrite ne retraite jamais les fichiers déjà faits : seuls les fichiers manquants sont transcrits, et le résumé affiché distingue répliques traitées / ignorées / déjà transcrites auparavant.

### Reconnexion

En cas de déconnexion vocale (perte réseau, kick, etc.), le bot tente de se reconnecter automatiquement sans perdre le fil de la session en cours.

## Règles métier / contraintes

- **Jamais d'audio brut stocké** en dehors du mode `local` explicitement choisi pour le développement — en mode `stt`, l'audio est transcrit puis immédiatement jeté.
- **Consentement explicite requis** : la notice est postée à chaque `/session start`, sans exception ni option de désactivation.
- **`/stop` est immédiat** : aucune réplique en cours de traitement ne doit survivre après la commande.
- Un échec technique lors de la transmission d'un segment audio (mode `stt`) ne doit **jamais interrompre la capture en cours** — il est compté et visible dans `/session status`, pas silencieusement ignoré ni fatal.
- Une session enregistrée en local (poste développeur) et une session enregistrée via Docker sont deux espaces de stockage distincts (chemins différents) — ce n'est pas un bug, mais il faut que le MJ/l'admin le sache pour retrouver ses fichiers.

## Hors périmètre

- Identification automatique de qui parle au sein d'un flux (diarisation fine au-delà du découpage par utilisateur Discord) : Phase 2.
- Déclenchement de l'agent IA sur mots-clés ou commandes `/scene` : Phase 2 (voir [06 — Câblage bout-en-bout](06-cablage-bout-en-bout.md) pour la partie polling ambiant, en Phase 1).
- Capture audio hors Discord (système, micro local) : explicitement écarté (voir README, section Analyse & Challenges).

## Critères d'acceptation

- [x] Le MJ peut démarrer/arrêter une capture par salon vocal avec consentement affiché à chaque fois.
- [x] L'audio de chaque participant est capté séparément.
- [x] Une session peut être transcrite après coup sans dupliquer les lignes déjà traitées.
- [x] Un échec de transcription en direct ne bloque pas la suite de la session.

## Pour aller plus loin (technique)

[.github/instructions/discord-bot.instructions.md](../../.github/instructions/discord-bot.instructions.md) · agent `discord-bot-dev`
