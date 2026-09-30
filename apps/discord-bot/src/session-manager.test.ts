import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AudioSegment } from '@rpg-assistant/shared-types';

// ── Mocks ──────────────────────────────────────────────────────────────────

const { entersStateMock } = vi.hoisted(() => ({ entersStateMock: vi.fn() }));

vi.mock('@discordjs/voice', () => ({
  VoiceConnectionStatus: {
    Ready: 'ready',
    Disconnected: 'disconnected',
    Signalling: 'signalling',
    Connecting: 'connecting',
  },
  entersState: entersStateMock,
}));

type FakeReceiverInstance = {
  onAudioSegmentCb?: (segment: AudioSegment) => void;
  onErrorCb?: (userId: string, err: Error) => void;
  onAudioSegment: (cb: (segment: AudioSegment) => void) => void;
  onError: (cb: (userId: string, err: Error) => void) => void;
  destroy: () => void;
};

const { receiverInstances, VoiceAudioReceiverMock } = vi.hoisted(() => {
  const instances: FakeReceiverInstance[] = [];

  // Plain function (not an arrow) so `new VoiceAudioReceiverMock()` binds
  // `this` to a fresh object we can mutate directly — mirrors how the real
  // VoiceAudioReceiver class instance behaves for session-manager's purposes.
  function FakeReceiverCtor(this: FakeReceiverInstance): void {
    this.destroy = vi.fn();
    this.onAudioSegment = (cb: (segment: AudioSegment) => void) => {
      this.onAudioSegmentCb = cb;
    };
    this.onError = (cb: (userId: string, err: Error) => void) => {
      this.onErrorCb = cb;
    };
    instances.push(this);
  }

  const ctor = vi.fn(FakeReceiverCtor);
  return { receiverInstances: instances, VoiceAudioReceiverMock: ctor };
});

vi.mock('./voice/receiver', () => ({ VoiceAudioReceiver: VoiceAudioReceiverMock }));

const { dispatchAudioSegmentMock } = vi.hoisted(() => ({ dispatchAudioSegmentMock: vi.fn() }));
vi.mock('./audio-output', () => ({ dispatchAudioSegment: dispatchAudioSegmentMock }));

const { sessionRepositoryMock, transcriptRepositoryMock } = vi.hoisted(() => ({
  sessionRepositoryMock: { save: vi.fn(), update: vi.fn() },
  transcriptRepositoryMock: { countBySession: vi.fn().mockReturnValue(0) },
}));
vi.mock('./database', () => ({
  sessionRepository: sessionRepositoryMock,
  transcriptRepository: transcriptRepositoryMock,
}));

import { sessionManager } from './session-manager';

// ── Test fixtures ────────────────────────────────────────────────────────────

function makeConnection() {
  const handlers: Record<string, () => void> = {};
  return {
    on: vi.fn((event: string, cb: () => void) => {
      handlers[event] = cb;
    }),
    destroy: vi.fn(),
    _handlers: handlers,
  };
}

function makeGuild() {
  return { id: 'guild-1' };
}

function makeSegment(overrides: Partial<AudioSegment> = {}): AudioSegment {
  return {
    segmentId: 'seg-1',
    sessionId: 'whatever', // session-manager doesn't rewrite this itself
    userId: 'user-1',
    username: 'alice',
    displayName: 'Alice',
    isGM: true,
    startTimestamp: new Date('2026-01-01T10:00:00.000Z'),
    endTimestamp: new Date('2026-01-01T10:00:01.000Z'),
    durationMs: 1000,
    wavBuffer: Buffer.from([1, 2, 3]),
    ...overrides,
  };
}

describe('sessionManager', () => {
  beforeEach(async () => {
    entersStateMock.mockReset();
    dispatchAudioSegmentMock.mockReset();
    sessionRepositoryMock.save.mockReset();
    sessionRepositoryMock.update.mockReset();
    receiverInstances.length = 0;
    // Ensure no session is left active between tests (each test starts clean).
    if (sessionManager.isActive()) {
      entersStateMock.mockResolvedValue(undefined);
      await sessionManager.stop().catch(() => undefined);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('start()', () => {
    it('starts a session once the voice connection is ready', async () => {
      entersStateMock.mockResolvedValueOnce(undefined); // Ready

      const connection = makeConnection();
      const session = await sessionManager.start({
        connection: connection as never,
        guild: makeGuild() as never,
        channelId: 'channel-1',
        gmUserIds: ['gm-1'],
      });

      expect(session.status).toBe('active');
      expect(session.channelId).toBe('channel-1');
      expect(sessionManager.isActive()).toBe(true);
      expect(sessionManager.getStatus()).toEqual(session);
      expect(sessionRepositoryMock.save).toHaveBeenCalledWith(session);
      expect(receiverInstances).toHaveLength(1);
    });

    it('rejects and destroys the connection if it never becomes ready', async () => {
      entersStateMock.mockRejectedValueOnce(new Error('timeout'));
      const connection = makeConnection();

      await expect(
        sessionManager.start({
          connection: connection as never,
          guild: makeGuild() as never,
          channelId: 'channel-1',
          gmUserIds: ['gm-1'],
        }),
      ).rejects.toThrow(/within 10 seconds/);

      expect(connection.destroy).toHaveBeenCalledOnce();
      expect(sessionManager.isActive()).toBe(false);
    });

    it('refuses to start a second session while one is already active', async () => {
      entersStateMock.mockResolvedValue(undefined);
      await sessionManager.start({
        connection: makeConnection() as never,
        guild: makeGuild() as never,
        channelId: 'channel-1',
        gmUserIds: ['gm-1'],
      });

      await expect(
        sessionManager.start({
          connection: makeConnection() as never,
          guild: makeGuild() as never,
          channelId: 'channel-2',
          gmUserIds: ['gm-1'],
        }),
      ).rejects.toThrow(/already active/);
    });
  });

  describe('stop()', () => {
    it('throws when there is no active session', async () => {
      await expect(sessionManager.stop()).rejects.toThrow(/No active session/);
    });

    it('ends the active session and releases voice resources', async () => {
      entersStateMock.mockResolvedValue(undefined);
      const connection = makeConnection();
      const session = await sessionManager.start({
        connection: connection as never,
        guild: makeGuild() as never,
        channelId: 'channel-1',
        gmUserIds: ['gm-1'],
      });
      const receiver = receiverInstances[0]!;

      const ended = await sessionManager.stop();

      expect(ended.id).toBe(session.id);
      expect(ended.status).toBe('ended');
      expect(ended.endedAt).toBeDefined();
      expect(receiver.destroy).toHaveBeenCalledOnce();
      expect(connection.destroy).toHaveBeenCalledOnce();
      expect(sessionRepositoryMock.update).toHaveBeenCalledWith(ended);
      expect(sessionManager.isActive()).toBe(false);
    });
  });

  describe('reconnection on disconnect', () => {
    it('does not end the session when the connection quickly re-establishes', async () => {
      entersStateMock.mockResolvedValueOnce(undefined); // Ready
      const connection = makeConnection();
      await sessionManager.start({
        connection: connection as never,
        guild: makeGuild() as never,
        channelId: 'channel-1',
        gmUserIds: ['gm-1'],
      });

      // Next entersState calls are the Promise.race in handleDisconnect — resolve fast.
      entersStateMock.mockResolvedValue(undefined);

      connection._handlers['disconnected']?.();
      await vi.waitFor(() => expect(sessionManager.isActive()).toBe(true));
    });

    it('ends the session when the connection cannot be re-established', async () => {
      entersStateMock.mockResolvedValueOnce(undefined); // Ready
      const connection = makeConnection();
      await sessionManager.start({
        connection: connection as never,
        guild: makeGuild() as never,
        channelId: 'channel-1',
        gmUserIds: ['gm-1'],
      });

      // Both race branches (Signalling/Connecting) reject → reconnection fails.
      entersStateMock.mockRejectedValue(new Error('still disconnected'));

      connection._handlers['disconnected']?.();
      await vi.waitFor(() => expect(sessionManager.isActive()).toBe(false));
    });
  });

  describe('audio dispatch error handling', () => {
    it('does not increment the failure counter when dispatch succeeds', async () => {
      entersStateMock.mockResolvedValueOnce(undefined);
      dispatchAudioSegmentMock.mockResolvedValue(undefined);
      await sessionManager.start({
        connection: makeConnection() as never,
        guild: makeGuild() as never,
        channelId: 'channel-1',
        gmUserIds: ['gm-1'],
      });
      const receiver = receiverInstances[0]!;

      receiver.onAudioSegmentCb?.(makeSegment());
      await vi.waitFor(() => expect(dispatchAudioSegmentMock).toHaveBeenCalledOnce());

      expect(sessionManager.getDispatchFailureCount()).toBe(0);
    });

    it('logs and increments the failure counter instead of throwing when dispatch rejects', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      entersStateMock.mockResolvedValueOnce(undefined);
      dispatchAudioSegmentMock.mockRejectedValue(new Error('network down'));
      await sessionManager.start({
        connection: makeConnection() as never,
        guild: makeGuild() as never,
        channelId: 'channel-1',
        gmUserIds: ['gm-1'],
      });
      const receiver = receiverInstances[0]!;

      receiver.onAudioSegmentCb?.(makeSegment());

      await vi.waitFor(() => expect(sessionManager.getDispatchFailureCount()).toBe(1));
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Échec du traitement audio'),
        expect.anything(),
      );
    });

    it('accumulates failures across multiple rejected segments', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      entersStateMock.mockResolvedValueOnce(undefined);
      dispatchAudioSegmentMock.mockRejectedValue(new Error('network down'));
      await sessionManager.start({
        connection: makeConnection() as never,
        guild: makeGuild() as never,
        channelId: 'channel-1',
        gmUserIds: ['gm-1'],
      });
      const receiver = receiverInstances[0]!;

      receiver.onAudioSegmentCb?.(makeSegment({ segmentId: 'seg-1' }));
      receiver.onAudioSegmentCb?.(makeSegment({ segmentId: 'seg-2' }));

      await vi.waitFor(() => expect(sessionManager.getDispatchFailureCount()).toBe(2));
    });
  });
});
