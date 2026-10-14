import { describe, it, expect, vi } from 'vitest';
import type { TranscriptLine } from '@rpg-assistant/shared-types';
import { ContextManager } from './context-manager';
import { InvalidTransitionError } from './types';

function makeLine(overrides: Partial<TranscriptLine> = {}): TranscriptLine {
  return {
    id: 'line-1',
    sessionId: 'session-1',
    speakerId: 'user-1',
    speakerName: 'alice',
    displayName: 'Alice',
    text: 'Bonjour',
    startTimestamp: '2026-01-01T10:00:00.000Z',
    endTimestamp: '2026-01-01T10:00:03.000Z',
    isGM: true,
    ...overrides,
  };
}

describe('ContextManager state transitions', () => {
  it('starts idle and moves to active on start()', () => {
    const cm = new ContextManager();
    expect(cm.getSnapshot().status).toBe('idle');

    cm.start('session-1');

    expect(cm.getSnapshot().status).toBe('active');
    expect(cm.getSnapshot().sessionId).toBe('session-1');
  });

  it('supports the full active → paused → active → ended cycle', () => {
    const cm = new ContextManager();
    cm.start('session-1');
    cm.pause();
    expect(cm.getSnapshot().status).toBe('paused');
    cm.resume();
    expect(cm.getSnapshot().status).toBe('active');
    cm.end();
    expect(cm.getSnapshot().status).toBe('ended');
  });

  it('allows ending directly from paused', () => {
    const cm = new ContextManager();
    cm.start('session-1');
    cm.pause();
    cm.end();
    expect(cm.getSnapshot().status).toBe('ended');
  });

  it('rejects invalid transitions', () => {
    const cm = new ContextManager();
    expect(() => cm.pause()).toThrow(InvalidTransitionError);
    expect(() => cm.resume()).toThrow(InvalidTransitionError);
    expect(() => cm.end()).toThrow(InvalidTransitionError);

    cm.start('session-1');
    expect(() => cm.start('session-2')).toThrow(InvalidTransitionError);

    cm.end();
    expect(() => cm.pause()).toThrow(InvalidTransitionError);
    expect(() => cm.resume()).toThrow(InvalidTransitionError);
    expect(() => cm.start('session-3')).toThrow(InvalidTransitionError); // ENDED is terminal
  });

  it('resets scene/history/music/image on a fresh instance for the next session', () => {
    const cm1 = new ContextManager();
    cm1.start('session-1');
    cm1.setScene('exploration', 'mystérieux');
    cm1.appendTranscriptLine(makeLine());
    cm1.setActiveMusic({ track: 'forest', setAt: new Date().toISOString() });
    cm1.end();

    // ENDED is terminal — a new session uses a fresh ContextManager instance,
    // mirroring how session-manager.ts creates a new Session per /session start.
    const cm2 = new ContextManager();
    cm2.start('session-2');
    const snapshot = cm2.getSnapshot();
    expect(snapshot.scene).toBe('');
    expect(snapshot.mood).toBe('');
    expect(snapshot.history).toHaveLength(0);
    expect(snapshot.activeMusic).toBeNull();
  });
});

describe('ContextManager mutations', () => {
  it('rejects mutations before a session is started', () => {
    const cm = new ContextManager();
    expect(() => cm.setScene('combat', 'tendu')).toThrow(/session status is "idle"/);
    expect(() => cm.appendTranscriptLine(makeLine())).toThrow(/session status is "idle"/);
  });

  it('rejects mutations after a session has ended', () => {
    const cm = new ContextManager();
    cm.start('session-1');
    cm.end();
    expect(() => cm.setScene('combat', 'tendu')).toThrow(/session status is "ended"/);
  });

  it('allows mutations while paused', () => {
    const cm = new ContextManager();
    cm.start('session-1');
    cm.pause();
    expect(() => cm.setScene('combat', 'tendu')).not.toThrow();
    expect(cm.getSnapshot().scene).toBe('combat');
  });

  it('updates scene and mood', () => {
    const cm = new ContextManager();
    cm.start('session-1');
    cm.setScene('combat', 'tendu');
    const snapshot = cm.getSnapshot();
    expect(snapshot.scene).toBe('combat');
    expect(snapshot.mood).toBe('tendu');
  });

  it('caps transcript history at the configured limit, dropping the oldest lines', () => {
    const cm = new ContextManager({ historyLimit: 3 });
    cm.start('session-1');
    for (let i = 0; i < 5; i++) {
      cm.appendTranscriptLine(makeLine({ id: `line-${i}`, text: `text ${i}` }));
    }
    const { history } = cm.getSnapshot();
    expect(history).toHaveLength(3);
    expect(history.map((l) => l.id)).toEqual(['line-2', 'line-3', 'line-4']);
  });

  it('sets and clears active music/image', () => {
    const cm = new ContextManager();
    cm.start('session-1');

    cm.setActiveMusic({ track: 'forest', setAt: '2026-01-01T10:00:00.000Z' });
    expect(cm.getSnapshot().activeMusic?.track).toBe('forest');

    cm.setActiveImage({ query: 'dark ruins', source: 'library', setAt: '2026-01-01T10:00:00.000Z' });
    expect(cm.getSnapshot().activeImage?.query).toBe('dark ruins');

    cm.setActiveMusic(null);
    expect(cm.getSnapshot().activeMusic).toBeNull();
  });
});

describe('ContextManager events', () => {
  it('emits stateChanged, sceneChanged, transcriptAppended and musicChanged events', () => {
    const cm = new ContextManager();
    const listener = vi.fn();
    cm.onEvent(listener);

    cm.start('session-1');
    cm.setScene('combat', 'tendu');
    cm.appendTranscriptLine(makeLine());
    cm.setActiveMusic({ track: 'battle', setAt: new Date().toISOString() });

    const types = listener.mock.calls.map(([event]) => event.type);
    expect(types).toEqual(['stateChanged', 'sceneChanged', 'transcriptAppended', 'musicChanged']);
  });

  it('stops notifying a listener after it unsubscribes', () => {
    const cm = new ContextManager();
    const listener = vi.fn();
    const unsubscribe = cm.onEvent(listener);

    cm.start('session-1');
    unsubscribe();
    cm.setScene('combat', 'tendu');

    expect(listener).toHaveBeenCalledTimes(1); // only stateChanged, before unsubscribe
  });
});
