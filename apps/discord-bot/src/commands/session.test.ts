import { describe, it, expect, vi, beforeEach } from 'vitest';

const { readdirMock } = vi.hoisted(() => ({ readdirMock: vi.fn() }));
const { sessionRepositorySaveMock } = vi.hoisted(() => ({ sessionRepositorySaveMock: vi.fn() }));

vi.mock('node:fs/promises', () => ({ readdir: readdirMock }));

vi.mock('../database', () => ({
  sessionRepository: {
    save: sessionRepositorySaveMock,
    update: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    findRecent: vi.fn(),
    findByIdPrefix: vi.fn(),
  },
  transcriptRepository: {
    save: vi.fn(),
    findBySession: vi.fn(),
    countBySession: vi.fn(),
    existsBySessionAndSourceFile: vi.fn(),
  },
}));

vi.mock('../session-manager', () => ({
  sessionManager: {
    start: vi.fn(),
    stop: vi.fn(),
    isActive: vi.fn(),
    getStatus: vi.fn(),
    getDispatchFailureCount: vi.fn().mockReturnValue(0),
  },
}));

vi.mock('../post-session-transcriber', () => ({
  transcribeRecordingSession: vi.fn(),
}));

import { recoverOrphanedSession } from './session';

describe('recoverOrphanedSession', () => {
  beforeEach(() => {
    readdirMock.mockReset();
    sessionRepositorySaveMock.mockReset();
  });

  it('registers a minimal ended session when an exact-match folder exists on disk', async () => {
    readdirMock.mockResolvedValue(['420a3e57-7b48-4412-bde5-28e1bdb03a21', 'other-folder']);

    const result = await recoverOrphanedSession(
      '420a3e57-7b48-4412-bde5-28e1bdb03a21',
      '/recordings',
    );

    expect(result).toMatchObject({
      id: '420a3e57-7b48-4412-bde5-28e1bdb03a21',
      status: 'ended',
      guildId: 'unknown',
      channelId: 'unknown',
      gmUserIds: [],
    });
    expect(sessionRepositorySaveMock).toHaveBeenCalledWith(result);
  });

  it('matches on folder-name prefix when no exact match exists', async () => {
    readdirMock.mockResolvedValue(['420a3e57-7b48-4412-bde5-28e1bdb03a21']);

    const result = await recoverOrphanedSession('420a3e57', '/recordings');

    expect(result?.id).toBe('420a3e57-7b48-4412-bde5-28e1bdb03a21');
    expect(sessionRepositorySaveMock).toHaveBeenCalledOnce();
  });

  it('returns undefined when no folder matches the given id or prefix', async () => {
    readdirMock.mockResolvedValue(['some-other-session']);

    const result = await recoverOrphanedSession('420a3e57', '/recordings');

    expect(result).toBeUndefined();
    expect(sessionRepositorySaveMock).not.toHaveBeenCalled();
  });

  it('returns undefined when the recordings directory cannot be read', async () => {
    readdirMock.mockRejectedValue(new Error('ENOENT'));

    const result = await recoverOrphanedSession('420a3e57', '/recordings');

    expect(result).toBeUndefined();
    expect(sessionRepositorySaveMock).not.toHaveBeenCalled();
  });

  it('returns undefined if persisting the recovered session fails', async () => {
    readdirMock.mockResolvedValue(['420a3e57-7b48-4412-bde5-28e1bdb03a21']);
    sessionRepositorySaveMock.mockImplementation(() => {
      throw new Error('DB is locked');
    });

    const result = await recoverOrphanedSession('420a3e57', '/recordings');

    expect(result).toBeUndefined();
  });
});
