/**
 * applyPortedBassSound — does the SOURCE panel's patch travel with a ported
 * part, or does the track get a fresh bass preset?
 *
 * The policy under test: inherit Surge state, refuse everything else, and
 * never leave the track unsounded because a read failed.
 */

import type { TrackSoundSnapshot } from '@signalsandsorcery/plugin-sdk';
import { applyPortedBassSound } from '../port-sound';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SURGE_SNAPSHOT: TrackSoundSnapshot = {
  kind: 'preset',
  state: 'VALUETREE_BLOB',
  label: 'Deep Sub Growl',
  stateType: 'valuetree',
};

function makeSetup(snapshot: TrackSoundSnapshot | null, overrides: Record<string, any> = {}) {
  const host = {
    getTrackSound: jest.fn(async () => snapshot),
    shufflePreset: jest.fn(async () => ({ presetName: 'Random Bass 3' })),
    ...overrides,
  };
  const sound = { copySnapshot: jest.fn(async (_id: string, snap: TrackSoundSnapshot) => snap.label) };
  const source = { trackDbId: 'db-source', trackName: 'lead-9912' };
  return { host, sound, source };
}

describe('applyPortedBassSound — inherits a Surge patch', () => {
  it('copies the source snapshot onto the new track instead of shuffling', async () => {
    const { host, sound, source } = makeSetup(SURGE_SNAPSHOT);

    const result = await applyPortedBassSound({ host: host as any, sound, trackId: 'eng-new', source });

    expect(host.getTrackSound).toHaveBeenCalledWith('db-source');
    expect(sound.copySnapshot).toHaveBeenCalledWith('eng-new', SURGE_SNAPSHOT);
    expect(host.shufflePreset).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'inherited', label: 'Deep Sub Growl' });
  });

  it('treats a legacy snapshot with no stateType as Surge ValueTree state', async () => {
    const legacy: TrackSoundSnapshot = { kind: 'preset', state: 'OLD_BLOB', label: 'Pre-split' };
    const { host, sound, source } = makeSetup(legacy);

    const result = await applyPortedBassSound({ host: host as any, sound, trackId: 'eng-new', source });

    expect(result.outcome).toBe('inherited');
    expect(host.shufflePreset).not.toHaveBeenCalled();
  });
});

describe('applyPortedBassSound — falls back to a fresh bass preset', () => {
  it('refuses a third-party RAW blob (it cannot load into Surge XT)', async () => {
    const raw: TrackSoundSnapshot = {
      kind: 'preset',
      state: 'KONTAKT_RAW',
      label: 'Cinematic Cello',
      stateType: 'raw',
    };
    const { host, sound, source } = makeSetup(raw);

    const result = await applyPortedBassSound({ host: host as any, sound, trackId: 'eng-new', source });

    expect(sound.copySnapshot).not.toHaveBeenCalled();
    expect(host.shufflePreset).toHaveBeenCalledWith('eng-new');
    expect(result).toEqual({ outcome: 'shuffled', label: 'Random Bass 3' });
  });

  it("refuses a drum panel's sample path", async () => {
    const sample: TrackSoundSnapshot = { kind: 'sample', samplePath: '/kits/909/kick.wav', label: 'kick.wav' };
    const { host, sound, source } = makeSetup(sample);

    const result = await applyPortedBassSound({ host: host as any, sound, trackId: 'eng-new', source });

    expect(sound.copySnapshot).not.toHaveBeenCalled();
    expect(result.outcome).toBe('shuffled');
  });

  it("refuses an instrument panel's zones", async () => {
    const instrument: TrackSoundSnapshot = {
      kind: 'instrument',
      displayName: 'Felt Piano',
      instrumentId: 'inst-1',
      zones: [{ samplePath: '/a.wav', rootNote: 60, loNote: 0, hiNote: 127 }] as any,
      label: 'Felt Piano',
    };
    const { host, sound, source } = makeSetup(instrument);

    const result = await applyPortedBassSound({ host: host as any, sound, trackId: 'eng-new', source });

    expect(sound.copySnapshot).not.toHaveBeenCalled();
    expect(result.outcome).toBe('shuffled');
  });

  it('shuffles when the source has no persisted sound', async () => {
    const { host, sound, source } = makeSetup(null);

    const result = await applyPortedBassSound({ host: host as any, sound, trackId: 'eng-new', source });

    expect(sound.copySnapshot).not.toHaveBeenCalled();
    expect(result.outcome).toBe('shuffled');
  });

  it('shuffles when the source read throws', async () => {
    const { host, sound, source } = makeSetup(null, {
      getTrackSound: jest.fn(async () => {
        throw new Error('db unavailable');
      }),
    });

    const result = await applyPortedBassSound({ host: host as any, sound, trackId: 'eng-new', source });

    expect(host.shufflePreset).toHaveBeenCalledWith('eng-new');
    expect(result.outcome).toBe('shuffled');
  });

  it('shuffles when no source is supplied (pre-2.68.0 host)', async () => {
    const { host, sound } = makeSetup(SURGE_SNAPSHOT);

    const result = await applyPortedBassSound({ host: host as any, sound, trackId: 'eng-new' });

    expect(host.getTrackSound).not.toHaveBeenCalled();
    expect(host.shufflePreset).toHaveBeenCalledWith('eng-new');
    expect(result.outcome).toBe('shuffled');
  });

  it('shuffles when the host has no getTrackSound at all', async () => {
    const { sound, source } = makeSetup(SURGE_SNAPSHOT);
    const host = { shufflePreset: jest.fn(async () => ({ presetName: 'Random Bass 3' })) };

    const result = await applyPortedBassSound({ host: host as any, sound, trackId: 'eng-new', source });

    expect(host.shufflePreset).toHaveBeenCalledWith('eng-new');
    expect(result.outcome).toBe('shuffled');
  });
});

describe('applyPortedBassSound — never rolls back the port', () => {
  it('swallows an exhausted preset pool and leaves the default patch', async () => {
    const { host, sound, source } = makeSetup(null, {
      shufflePreset: jest.fn(async () => {
        throw new Error('no presets available');
      }),
    });

    await expect(
      applyPortedBassSound({ host: host as any, sound, trackId: 'eng-new', source }),
    ).resolves.toEqual({ outcome: 'shuffled' });
  });

  it('swallows a failed copy read and still sounds the track', async () => {
    const { host, source } = makeSetup(SURGE_SNAPSHOT);
    const sound = {
      copySnapshot: jest.fn(async () => {
        throw new Error('setPluginState failed');
      }),
    };

    const result = await applyPortedBassSound({ host: host as any, sound, trackId: 'eng-new', source });

    expect(host.shufflePreset).toHaveBeenCalledWith('eng-new');
    expect(result.outcome).toBe('shuffled');
  });
});
