import type { AudioPreferences, SessionAudioPreferences } from '../src/shared/domain/types';
import {
  createDefaultSessionConfiguration,
  defaultAudioPreferences,
} from '../src/shared/domain/defaults';
import { AudioService } from '../src/renderer/services/audio/AudioService';

function audioPreferences(patch: Partial<AudioPreferences> = {}): AudioPreferences {
  return {
    ...defaultAudioPreferences,
    quietHours: { ...defaultAudioPreferences.quietHours },
    ...patch,
  };
}

const sessionPreferences: SessionAudioPreferences =
  createDefaultSessionConfiguration('session-1').audio;

describe('phase 8 audio service', () => {
  it('suppresses routine completion sounds for the watched session by default', async () => {
    const played: string[] = [];
    const service = new AudioService(undefined, (asset) => {
      played.push(asset.id);
    });

    const decision = await service.handleEvent('session.estimated_completion', {
      preferences: audioPreferences(),
      sessionId: 'session-1',
      sessionPreferences,
      focusedSessionId: 'session-1',
      appFocused: true,
      relevantSessionWatched: true,
      now: new Date(2026, 0, 6, 12, 0),
    });

    expect(decision.reason).toBe('focused_suppression');
    expect(played).toEqual([]);
  });

  it('plays routine completion sounds when the app is unfocused', async () => {
    const played: string[] = [];
    const service = new AudioService(undefined, (asset) => {
      played.push(asset.id);
    });

    const decision = await service.handleEvent('session.estimated_completion', {
      preferences: audioPreferences(),
      sessionId: 'session-1',
      sessionPreferences,
      focusedSessionId: 'session-1',
      appFocused: false,
      relevantSessionWatched: false,
      now: new Date(2026, 0, 6, 12, 0),
    });

    expect(decision.reason).toBe('played');
    expect(played).toEqual(['estimated-completion']);
  });

  it('honors Do Not Disturb before playback', async () => {
    const played: string[] = [];
    const service = new AudioService(undefined, (asset) => {
      played.push(asset.id);
    });

    const decision = await service.handleEvent('session.crashed', {
      preferences: audioPreferences({ doNotDisturb: true }),
      appFocused: false,
      relevantSessionWatched: false,
      now: new Date(2026, 0, 6, 12, 0),
    });

    expect(decision.reason).toBe('do_not_disturb');
    expect(played).toEqual([]);
  });

  it('handles quiet hours that cross midnight', async () => {
    const played: string[] = [];
    const service = new AudioService(undefined, (asset) => {
      played.push(asset.id);
    });

    const decision = await service.handleEvent('session.ready', {
      preferences: audioPreferences({
        quietHours: {
          enabled: true,
          startTime: '22:00',
          endTime: '07:00',
          days: [0, 1, 2, 3, 4, 5, 6],
          allowAuthDisconnectSounds: false,
          allowCrashSounds: false,
        },
      }),
      appFocused: false,
      relevantSessionWatched: false,
      now: new Date(2026, 0, 6, 23, 30),
    });

    expect(decision.reason).toBe('quiet_hours');
    expect(played).toEqual([]);
  });

  it('applies cooldowns per event and session', async () => {
    const played: string[] = [];
    const service = new AudioService(undefined, (asset) => {
      played.push(asset.id);
    });
    const preferences = audioPreferences({ cooldownMs: 5000 });

    const first = await service.handleEvent('session.ready', {
      preferences,
      sessionId: 'session-1',
      sessionPreferences,
      appFocused: false,
      relevantSessionWatched: false,
      now: new Date(2026, 0, 6, 12, 0, 0),
    });
    const second = await service.handleEvent('session.ready', {
      preferences,
      sessionId: 'session-1',
      sessionPreferences,
      appFocused: false,
      relevantSessionWatched: false,
      now: new Date(2026, 0, 6, 12, 0, 2),
    });

    expect(first.reason).toBe('played');
    expect(second.reason).toBe('cooldown');
    expect(played).toEqual(['session-ready']);
  });

  it('plays one completion sound per activity cycle', async () => {
    const played: string[] = [];
    const service = new AudioService(undefined, (asset) => {
      played.push(asset.id);
    });
    const preferences = audioPreferences({ cooldownMs: 0 });

    await service.handleEvent('session.estimated_completion', {
      preferences,
      sessionId: 'session-1',
      sessionPreferences,
      appFocused: false,
      relevantSessionWatched: false,
      now: new Date(2026, 0, 6, 12, 0),
    });
    const latched = await service.handleEvent('session.estimated_completion', {
      preferences,
      sessionId: 'session-1',
      sessionPreferences,
      appFocused: false,
      relevantSessionWatched: false,
      now: new Date(2026, 0, 6, 12, 1),
    });
    await service.handleEvent('session.activity_started', {
      preferences,
      sessionId: 'session-1',
      sessionPreferences,
      appFocused: false,
      relevantSessionWatched: false,
    });
    const reset = await service.handleEvent('session.estimated_completion', {
      preferences,
      sessionId: 'session-1',
      sessionPreferences,
      appFocused: false,
      relevantSessionWatched: false,
      now: new Date(2026, 0, 6, 12, 2),
    });

    expect(latched.reason).toBe('latched');
    expect(reset.reason).toBe('played');
    expect(played).toEqual(['estimated-completion', 'estimated-completion']);
  });
});
