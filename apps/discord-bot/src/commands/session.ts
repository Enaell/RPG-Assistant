import {
  SlashCommandBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type TextChannel,
  type VoiceChannel,
} from 'discord.js';
import { joinVoiceChannel } from '@discordjs/voice';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Session } from '@rpg-assistant/shared-types';
import type { Env } from '../index';
import { sessionManager } from '../session-manager';
import { sessionRepository, transcriptRepository } from '../database';
import { transcribeRecordingSession } from '../post-session-transcriber';

// ── Command definition ────────────────────────────────────────

export const sessionCommandDef = new SlashCommandBuilder()
  .setName('session')
  .setDescription('Gérer une session RPG')
  .addSubcommand((sub) =>
    sub
      .setName('start')
      .setDescription('Démarrer une nouvelle session de capture audio')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Salon vocal à rejoindre')
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true),
      )
      .addUserOption((opt) =>
        opt
          .setName('gm')
          .setDescription('Le Maître du Jeu (défaut : vous-même)')
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('stop').setDescription('Arrêter la session en cours et quitter le vocal'),
  )
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('Afficher le statut de la session active'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('list')
      .setDescription('Lister les 5 dernières sessions enregistrées'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('transcribe')
      .setDescription('Transcrire les enregistrements WAV d\'une session locale (post-séance)')
      .addStringOption((opt) =>
        opt
          .setName('session-id')
          .setDescription('ID ou préfixe UUID de la session (défaut : dernière session)')
          .setRequired(false),
      ),
  );

// ── Dispatcher ───────────────────────────────────────────────

export async function handleSessionCommand(
  interaction: ChatInputCommandInteraction,
  _env: Env,
): Promise<void> {
  const sub = interaction.options.getSubcommand(true);

  if (sub === 'start') await handleStart(interaction);
  else if (sub === 'stop') await handleStop(interaction);
  else if (sub === 'status') await handleStatus(interaction);
  else if (sub === 'list') await handleList(interaction);
  else if (sub === 'transcribe') await handleTranscribe(interaction, _env);
}

// ── /session start ────────────────────────────────────────────

async function handleStart(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (sessionManager.isActive()) {
    await interaction.editReply(
      "⚠️ Une session est déjà en cours. Utilisez `/session stop` pour l'arrêter d'abord.",
    );
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('❌ Cette commande doit être utilisée dans un serveur Discord.');
    return;
  }

  const channel = interaction.options.getChannel('channel', true);

  // Type guard: ensure the resolved channel is actually a voice channel object
  if (channel.type !== ChannelType.GuildVoice) {
    await interaction.editReply('❌ Le salon sélectionné doit être un salon vocal.');
    return;
  }

  const voiceChannel = channel as VoiceChannel;
  const gmUser = interaction.options.getUser('gm') ?? interaction.user;

  // ── Consent notice ────────────────────────────────────────
  // Per our privacy policy: all participants must be informed before capture.
  const textChannel = interaction.channel as TextChannel | null;
  if (textChannel?.isTextBased()) {
    await textChannel.send(
      '🎙️ **Début de session RPG — Capture audio activée**\n' +
      `Salon vocal : <#${voiceChannel.id}> | Maître du Jeu : <@${gmUser.id}>\n` +
      '> ⚠️ En restant dans le salon vocal, vous consentez à la capture de vos ' +
      "prises de parole à des fins de transcription. L'audio est transcrit par " +
      "segments courts et n'est jamais conservé. Utilisez `/session stop` pour arrêter.",
    );
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false, // Must be false to receive audio from other users
    selfMute: true,  // The bot does not transmit audio
  });

  const session = await sessionManager.start({
    connection,
    guild,
    channelId: voiceChannel.id,
    gmUserIds: [gmUser.id],
  });

  await interaction.editReply(
    `✅ Session **${session.id.slice(0, 8)}…** démarrée.\n` +
    `Capture audio en cours dans <#${voiceChannel.id}>.`,
  );
}

// ── /session stop ─────────────────────────────────────────────

async function handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!sessionManager.isActive()) {
    await interaction.editReply('⚠️ Aucune session en cours.');
    return;
  }

  const session = await sessionManager.stop();

  const textChannel = interaction.channel as TextChannel | null;
  if (textChannel?.isTextBased()) {
    await textChannel.send(
      '⏹️ **Session terminée — Capture audio arrêtée**\n' +
      `ID : \`${session.id}\` | Durée : ${formatDuration(session.startedAt, session.endedAt ?? new Date().toISOString())}`,
    );
  }

  await interaction.editReply(`✅ Session **${session.id.slice(0, 8)}…** terminée.`);
}

// ── /session status ───────────────────────────────────────────

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const info = sessionManager.getStatus();

  if (info === null) {
    await interaction.reply({ content: '💤 Aucune session active.', ephemeral: true });
    return;
  }

  const duration = formatDuration(info.startedAt, new Date().toISOString());
  const gms = info.gmUserIds.map((id) => `<@${id}>`).join(', ');
  const failures = sessionManager.getDispatchFailureCount();

  await interaction.reply({
    content:
      '📋 **Session en cours**\n' +
      `ID : \`${info.id}\`\n` +
      `Canal : <#${info.channelId}>\n` +
      `Durée : ${duration}\n` +
      `MJ(s) : ${gms}` +
      (failures > 0 ? `\n⚠️ ${failures} échec(s) de traitement audio (voir les logs)` : ''),
    ephemeral: true,
  });
}

// ── /session list ─────────────────────────────────────────────

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const sessions = sessionRepository.findRecent(5);

  if (sessions.length === 0) {
    await interaction.editReply('💤 Aucune session enregistrée en base de données.');
    return;
  }

  const lines = sessions.map((s) => {
    const lineCount = transcriptRepository.countBySession(s.id);
    const started = new Date(s.startedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const duration = s.endedAt
      ? formatDuration(s.startedAt, s.endedAt)
      : '(en cours)';
    const statusEmoji = s.status === 'ended' ? '✅' : s.status === 'active' ? '🎙️' : '⏸️';
    return (
      `${statusEmoji} \`${s.id.slice(0, 8)}\` — ${started} — ${duration}` +
      (lineCount > 0 ? ` — 📝 ${lineCount} lignes` : ' — aucune transcription')
    );
  });

  await interaction.editReply(
    '📋 **5 dernières sessions**\n' +
    lines.join('\n') +
    '\n\nUtilisez `/session transcribe session-id:<préfixe>` pour transcrire une session locale.',
  );
}

// ── /session transcribe ───────────────────────────────────────

async function handleTranscribe(
  interaction: ChatInputCommandInteraction,
  env: Env,
): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  // Validate API key — needed even when AUDIO_OUTPUT_MODE=local
  const apiKey = env.MISTRAL_API_KEY;
  if (!apiKey) {
    await interaction.editReply(
      '❌ `MISTRAL_API_KEY` non définie. Ajoutez-la dans `.env` pour utiliser la transcription post-séance.',
    );
    return;
  }

  const recordingsDir = resolve(process.cwd(), env.RECORDINGS_DIR);

  // Resolve target session
  const rawId = interaction.options.getString('session-id');
  let session = rawId
    ? (sessionRepository.findById(rawId) ?? sessionRepository.findByIdPrefix(rawId))
    : sessionRepository.findRecent(1)[0];

  // Fallback: a matching WAV folder can exist on disk with no DB row — either
  // it predates the SQLite persistence feature, or /session start never
  // finished writing the row (crash, moved recordings, different RECORDINGS_DIR
  // between the run that captured it and the run reading it now).
  if (!session && rawId) {
    session = await recoverOrphanedSession(rawId, recordingsDir);
  }

  if (!session) {
    await interaction.editReply(
      rawId
        ? `❌ Session \`${rawId}\` introuvable : ni en base de données, ni dans \`${recordingsDir}\`. ` +
        `Utilisez \`/session list\` pour voir les sessions disponibles.`
        : '❌ Aucune session trouvée en base de données. Lancez d\'abord une session avec `/session start`.',
    );
    return;
  }

  await interaction.editReply(
    `🔄 Transcription post-séance démarrée pour la session \`${session.id.slice(0, 8)}…\`\n` +
    `Répertoire : \`${recordingsDir}/${session.id}/\`\n` +
    `Modèle STT : \`${env.STT_MODEL}\``,
  );

  let lastEditAt = Date.now();

  try {
    const result = await transcribeRecordingSession(
      session.id,
      recordingsDir,
      transcriptRepository,
      {
        mistralApiKey: apiKey,
        sttModel: env.STT_MODEL,
        sttLanguage: env.STT_LANGUAGE,
        onProgress: async (done, total, filename) => {
          // Rate-limit Discord edits to one every 5 seconds
          if (done === 0 || Date.now() - lastEditAt < 5_000) return;
          lastEditAt = Date.now();
          await interaction.editReply(
            `🔄 Transcription en cours… ${done}/${total} fichiers\n` +
            `Traitement : \`${filename}\``,
          ).catch(() => undefined);
        },
      },
    );

    const summary =
      `✅ **Transcription terminée** — session \`${session.id.slice(0, 8)}…\`\n` +
      `📝 ${result.processed} utterance(s) transcrite(s) et sauvegardées en base\n` +
      (result.skipped > 0 ? `⚠️ ${result.skipped} fichier(s) ignoré(s) (silence ou erreur STT)\n` : '') +
      (result.duplicates > 0 ? `↩️ ${result.duplicates} fichier(s) déjà transcrit(s) lors d'un run précédent, ignoré(s)\n` : '') +
      (result.transcriptPath ? `📄 Export texte : \`${result.transcriptPath}\`\n` : '') +
      `\nUtilisez les données dans \`transcript_lines\` pour générer un résumé de séance.`;

    await interaction.editReply(summary);

    const textChannel = interaction.channel as TextChannel | null;
    if (textChannel?.isTextBased() && !interaction.ephemeral) {
      await textChannel.send(
        `📜 **Transcription post-séance terminée** — session \`${session.id.slice(0, 8)}…\`\n` +
        `${result.processed} réplique(s) transcrite(s) depuis les enregistrements locaux.`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`❌ Erreur lors de la transcription : ${msg}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Register a minimal session row for a recordings folder found on disk but
 * absent from the DB, so it becomes transcribable and shows up in
 * `/session list` afterwards. guildId/channelId/gmUserIds cannot be recovered
 * from WAV filenames alone, so placeholder values are used.
 *
 * Exported for unit testing.
 */
export async function recoverOrphanedSession(
  rawId: string,
  recordingsDir: string,
): Promise<Session | undefined> {
  let entries: string[];
  try {
    entries = await readdir(recordingsDir);
  } catch {
    return undefined;
  }

  const folder = entries.find((name) => name === rawId) ?? entries.find((name) => name.startsWith(rawId));
  if (!folder) return undefined;

  const now = new Date().toISOString();
  const recovered: Session = {
    id: folder,
    guildId: 'unknown',
    channelId: 'unknown',
    startedAt: now,
    endedAt: now,
    status: 'ended',
    gmUserIds: [],
  };

  try {
    sessionRepository.save(recovered);
    console.log(`🩹 Session orpheline récupérée depuis le disque : ${folder}`);
  } catch (err) {
    console.error("❌ [DB] Impossible d'enregistrer la session récupérée :", err);
    return undefined;
  }

  return recovered;
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}
