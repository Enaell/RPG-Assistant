import {
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
} from '@discordjs/voice';
import type { Guild } from 'discord.js';
import { randomUUID } from 'node:crypto';
import type { Session, AudioSegment } from '@rpg-assistant/shared-types';
import { VoiceAudioReceiver } from './voice/receiver';
import { dispatchAudioSegment } from './audio-output';

// ── Types ────────────────────────────────────────────────────

type StartOptions = {
  connection: VoiceConnection;
  guild: Guild;
  channelId: string;
  gmUserIds: string[];
};

type ActiveState = {
  session: Session;
  connection: VoiceConnection;
  receiver: VoiceAudioReceiver;
};

// ── Singleton state ──────────────────────────────────────────

let state: ActiveState | null = null;

// ── Audio segment handler ────────────────────────────────────

/**
 * Called for every completed utterance captured from the voice channel.
 * Routes to local WAV save or STT hook depending on AUDIO_OUTPUT_MODE.
 */
function onAudioSegment(segment: AudioSegment): void {
  const duration = (segment.durationMs / 1000).toFixed(2);
  const role = segment.isGM ? ' 👑 MJ' : '';
  const size = (segment.wavBuffer.byteLength / 1024).toFixed(1);

  console.log(
    `🎤 [${segment.displayName}${role}] ` +
    `${segment.startTimestamp.toISOString().replace('T', ' ').slice(0, 19)} ` +
    `| ${duration}s | ${size} KB WAV`,
  );

  void dispatchAudioSegment(segment);
}

// ── Public API ───────────────────────────────────────────────

async function start(options: StartOptions): Promise<Session> {
  if (state !== null) {
    throw new Error('A session is already active. Call stop() first.');
  }

  // Wait up to 10 s for the voice connection to become ready
  try {
    await entersState(options.connection, VoiceConnectionStatus.Ready, 10_000);
  } catch {
    options.connection.destroy();
    throw new Error('Could not connect to the voice channel within 10 seconds.');
  }

  const session: Session = {
    id: randomUUID(),
    guildId: options.guild.id,
    channelId: options.channelId,
    startedAt: new Date().toISOString(),
    status: 'active',
    gmUserIds: options.gmUserIds,
  };

  const receiver = new VoiceAudioReceiver(
    options.connection,
    options.guild,
    session.id,
    options.gmUserIds,
  );

  receiver.onAudioSegment(onAudioSegment);

  receiver.onError((userId, err) => {
    console.error(`[voice] Capture error for user ${userId}:`, err.message);
  });

  // Auto-recover from transient disconnects; stop cleanly on fatal ones
  options.connection.on(VoiceConnectionStatus.Disconnected, () => {
    void handleDisconnect(options.connection);
  });

  state = { session, connection: options.connection, receiver };
  console.log(`🎮 Session ${session.id} started (channel: ${session.channelId})`);

  return session;
}

async function stop(): Promise<Session> {
  if (state === null) {
    throw new Error('No active session to stop.');
  }

  const { session, connection, receiver } = state;
  state = null;

  receiver.destroy();
  connection.destroy();

  const ended: Session = {
    ...session,
    status: 'ended',
    endedAt: new Date().toISOString(),
  };

  console.log(`⏹️ Session ${ended.id} ended.`);
  return ended;
}

function isActive(): boolean {
  return state !== null;
}

function getStatus(): Session | null {
  return state?.session ?? null;
}

export const sessionManager = { start, stop, isActive, getStatus };

// ── Helpers ──────────────────────────────────────────────────

async function handleDisconnect(connection: VoiceConnection): Promise<void> {
  try {
    // Discord sometimes disconnects briefly; try to reconnect within 5 s
    await Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
      entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
    ]);
    console.log('[voice] Reconnecting...');
  } catch {
    // Could not reconnect — end the session to release resources
    console.warn('[voice] Connection lost and could not be re-established. Ending session.');
    if (state !== null) {
      await stop().catch(() => undefined);
    }
  }
}
