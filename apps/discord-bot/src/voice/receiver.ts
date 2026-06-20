import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { VoiceConnection } from '@discordjs/voice';
import type { Guild, GuildMember } from 'discord.js';
import type { AudioSegment } from '@rpg-assistant/shared-types';
import { captureUserUtterance } from './user-audio-stream';

// ── Typed event helpers ────────────────────────────────────

type ReceiverEvents = {
  audioSegment: [segment: AudioSegment];
  error: [userId: string, error: Error];
};

// ── VoiceAudioReceiver ─────────────────────────────────────

/**
 * Listens to per-user Opus audio streams inside a Discord voice connection,
 * decodes them to 16 kHz mono WAV, and emits `audioSegment` events.
 *
 * One AudioSegment is emitted per utterance (i.e. each time a user speaks
 * and then stops for 500 ms).
 *
 * Usage:
 *   const recv = new VoiceAudioReceiver(connection, guild, sessionId, gmIds)
 *   recv.onAudioSegment(segment => { ... })  // hook up STT here
 *   recv.onError((userId, err) => { ... })
 *   // later:
 *   recv.destroy()
 */
export class VoiceAudioReceiver {
  private readonly emitter = new EventEmitter();
  private readonly connection: VoiceConnection;
  private readonly guild: Guild;
  private readonly sessionId: string;
  private readonly gmUserIds: ReadonlySet<string>;

  /** Prevents concurrent captures for the same user */
  private readonly activeCaptures = new Set<string>();

  constructor(
    connection: VoiceConnection,
    guild: Guild,
    sessionId: string,
    gmUserIds: string[],
  ) {
    this.connection = connection;
    this.guild = guild;
    this.sessionId = sessionId;
    this.gmUserIds = new Set(gmUserIds);
    this.setupListeners();
  }

  // ── Public API ──────────────────────────────────────────

  onAudioSegment(listener: (segment: AudioSegment) => void): void {
    this.emitter.on('audioSegment', listener);
  }

  onError(listener: (userId: string, error: Error) => void): void {
    this.emitter.on('error', listener);
  }

  /** Remove all listeners and stop reacting to speaking events. */
  destroy(): void {
    this.connection.receiver.speaking.removeAllListeners('start');
    this.emitter.removeAllListeners();
    this.activeCaptures.clear();
  }

  // ── Private ─────────────────────────────────────────────

  private setupListeners(): void {
    this.connection.receiver.speaking.on('start', (userId) => {
      void this.handleUserStartedSpeaking(userId);
    });
  }

  private async handleUserStartedSpeaking(userId: string): Promise<void> {
    // Guard: skip if we are already capturing this user (can happen if the
    // speaking event fires again before the previous capture finishes)
    if (this.activeCaptures.has(userId)) return;
    this.activeCaptures.add(userId);

    const startTimestamp = new Date();

    try {
      // Run member resolution and audio capture concurrently.
      // Member lookup usually resolves from cache instantly; capture takes
      // several seconds. Both are ready by the time we need them.
      const [member, result] = await Promise.all([
        this.resolveMember(userId),
        captureUserUtterance(this.connection.receiver, userId),
      ]);

      if (result === null) return;

      const endTimestamp = new Date();

      const segment: AudioSegment = {
        segmentId: randomUUID(),
        sessionId: this.sessionId,
        userId,
        username: member.user.username,
        displayName: member.displayName,
        isGM: this.gmUserIds.has(userId),
        startTimestamp,
        endTimestamp,
        durationMs: result.durationMs,
        wavBuffer: result.wavBuffer,
      };

      this.emit('audioSegment', segment);
    } catch (err) {
      this.emit(
        'error',
        userId,
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      this.activeCaptures.delete(userId);
    }
  }

  private async resolveMember(userId: string): Promise<GuildMember> {
    const cached = this.guild.members.cache.get(userId);
    if (cached !== undefined) return cached;
    return this.guild.members.fetch(userId);
  }

  private emit<K extends keyof ReceiverEvents>(
    event: K,
    ...args: ReceiverEvents[K]
  ): void {
    this.emitter.emit(event, ...args);
  }
}
