import { TerminalReplayStore } from '../src/renderer/services/terminal/TerminalReplayStore';

describe('terminal replay store', () => {
  it('replays complete chunks and streams new output after a snapshot', () => {
    const store = new TerminalReplayStore(1024);
    store.append('session-1', 'before');
    const events: string[] = [];
    const unsubscribe = store.subscribe('session-1', (event) => {
      if (event.type === 'data') {
        events.push(event.data);
      }
    });

    expect(store.snapshot('session-1')).toBe('before');
    store.append('session-1', ' after');

    expect(events).toEqual([' after']);
    expect(store.snapshot('session-1')).toBe('before after');
    unsubscribe();
  });

  it('clears both the visible subscriber and the replay snapshot', () => {
    const store = new TerminalReplayStore(1024);
    const events: string[] = [];
    store.append('session-1', 'old output');
    store.subscribe('session-1', (event) => events.push(event.type));

    store.clear('session-1');

    expect(events).toEqual(['clear']);
    expect(store.snapshot('session-1')).toBe('');
  });

  it('bounds replay by UTF-8 bytes without splitting a Unicode code point', () => {
    const store = new TerminalReplayStore(8);
    store.append('session-1', 'prefix🙂🙂');

    const replay = store.snapshot('session-1');

    expect(replay.startsWith('\x1bc')).toBe(true);
    expect(replay.endsWith('🙂🙂')).toBe(true);
    expect(replay).not.toContain('\uFFFD');
  });
});
