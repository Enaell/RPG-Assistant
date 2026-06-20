import {
  SlashCommandBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type TextChannel,
  type VoiceChannel,
} from 'discord.js';
import { joinVoiceChannel } from '@discordjs/voice';
import type { Env } from '../index';
import { sessionManager } from '../session-manager';

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
      "prises de parole à des fins de transcription. L'audio est transcrit en temps " +
      "réel et n'est pas conservé. Utilisez `/session stop` pour arrêter.",
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

  await interaction.reply({
    content:
      '📋 **Session en cours**\n' +
      `ID : \`${info.id}\`\n` +
      `Canal : <#${info.channelId}>\n` +
      `Durée : ${duration}\n` +
      `MJ(s) : ${gms}`,
    ephemeral: true,
  });
}

// ── Helpers ───────────────────────────────────────────────────

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}
