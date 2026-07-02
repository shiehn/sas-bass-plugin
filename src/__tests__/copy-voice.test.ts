/**
 * copyBassVoice — per-voice DEEP copy appended to the group.
 *
 * The deep-copy discipline is the point of these tests: fresh identity (new
 * track, new dbId keys), notes copied by VALUE (no shared references with the
 * source), preset copied as a persisted state blob onto the NEW track, and no
 * scene-data key that mentions the source. Plus rollback + budget guards.
 */

import type { PluginMidiNote } from '@signalsandsorcery/plugin-sdk';
import { copyBassVoice } from '../copy-voice';
import type { BassVoiceMeta } from '../bass-voice-meta';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SOURCE_NOTES: PluginMidiNote[] = [
  { pitch: 26, startBeat: 1, durationBeats: 3, velocity: 100 },
  { pitch: 26, startBeat: 17, durationBeats: 3, velocity: 96 },
];

function makeHost(overrides: Record<string, any> = {}) {
  return {
    createTrack: jest.fn(async () => ({ id: 'eng-new', dbId: 'db-new', name: 'bass-copy' })),
    readMidiNotes: jest.fn(async () => ({ clips: [{ startTime: 0, endTime: 8, notes: SOURCE_NOTES }] })),
    getMusicalContext: jest.fn(async () => ({ bars: 16, bpm: 172 })),
    writeMidiClip: jest.fn(async (_trackId: string, _clip: { notes: PluginMidiNote[] }) => ({
      notesInserted: 2,
      bars: 16,
    })),
    setTrackRole: jest.fn(async () => {}),
    setTrackMute: jest.fn(async () => {}),
    setSceneData: jest.fn(async (_sceneId: string, _key: string, _value: unknown) => {}),
    deleteSceneData: jest.fn(async () => {}),
    deleteTrack: jest.fn(async () => {}),
    getTrackSound: jest.fn(async () => ({ kind: 'preset', state: 'BLOB', stateType: 'valuetree', label: 'Preset_7' })),
    showToast: jest.fn(),
    ...overrides,
  };
}

function makeSound() {
  return {
    applySound: jest.fn(async () => {}),
    captureSoundDescriptor: jest.fn(async () => ({ descriptor: { state: 'LIVE', stateType: 'valuetree' } })),
    copySnapshot: jest.fn(async () => 'Preset_7'),
    descriptorFromSnapshot: jest.fn((s: any) => ({ state: s.state, stateType: s.stateType })),
    acceptedSnapshotKind: 'preset' as const,
    historyMax: 12,
    importSoundLabel: 'Import Preset',
    importNoun: 'preset',
    previousSoundLabel: 'Previous preset',
  };
}

function makeMember(voiceIndex = 0, dbId = 'db-src', engineId = 'eng-src') {
  const meta: BassVoiceMeta = { groupId: 'db-anchor', voiceIndex, partition: 'low', label: 'low register' };
  return {
    dbId,
    meta,
    track: { handle: { id: engineId, dbId, name: 'bass-src' } } as any,
  };
}

function makeSetup(opts: { trackCount?: number; members?: ReturnType<typeof makeMember>[]; host?: Record<string, any> } = {}) {
  const host = makeHost(opts.host);
  const sound = makeSound();
  const members = opts.members ?? [makeMember(0), makeMember(1, 'db-src2', 'eng-src2')];
  const group = { groupId: 'db-anchor', members } as any;
  const services = {
    host,
    activeSceneId: 'scene-1',
    tracks: Array.from({ length: opts.trackCount ?? 3 }, (_, i) => ({ handle: { id: `t${i}`, dbId: `d${i}` } })),
    trackDataKey: (dbId: string, suffix: string) => `track:${dbId}:${suffix}`,
    reloadTracks: jest.fn(async () => {}),
  } as any;
  return { host, sound, group, services, member: members[0] };
}

describe('copyBassVoice — deep copy', () => {
  it('creates a NEW track and value-copies the notes (no shared references)', async () => {
    const { host, sound, group, services, member } = makeSetup();
    await copyBassVoice({ services, sound, group, member });

    expect(host.createTrack).toHaveBeenCalledTimes(1);
    expect(host.readMidiNotes).toHaveBeenCalledWith('eng-src');
    expect(host.writeMidiClip).toHaveBeenCalledTimes(1);
    const [targetId, clip] = host.writeMidiClip.mock.calls[0];
    expect(targetId).toBe('eng-new');
    // Same VALUES…
    expect(clip.notes).toEqual(SOURCE_NOTES);
    // …but no shared identity with the source, note-array or per-note.
    expect(clip.notes).not.toBe(SOURCE_NOTES);
    expect(clip.notes[0]).not.toBe(SOURCE_NOTES[0]);
    expect(clip.notes[1]).not.toBe(SOURCE_NOTES[1]);
  });

  it('copies the preset as a persisted snapshot onto the NEW track', async () => {
    const { host, sound, group, services, member } = makeSetup();
    await copyBassVoice({ services, sound, group, member });

    expect(host.getTrackSound).toHaveBeenCalledWith('db-src');
    expect(sound.copySnapshot).toHaveBeenCalledWith('eng-new', expect.objectContaining({ label: 'Preset_7' }));
    expect(sound.applySound).not.toHaveBeenCalled(); // snapshot path won
  });

  it('falls back to live instrument capture when no durable snapshot exists', async () => {
    const { host, sound, group, services, member } = makeSetup({ host: { getTrackSound: jest.fn(async () => null) } });
    await copyBassVoice({ services, sound, group, member });

    expect(sound.captureSoundDescriptor).toHaveBeenCalledWith('eng-src');
    expect(sound.applySound).toHaveBeenCalledWith('eng-new', { state: 'LIVE', stateType: 'valuetree' });
  });

  it('appends the meta under the NEW dbId: voiceIndex max+1, "(copy)" label, groupId preserved', async () => {
    const { host, sound, group, services, member } = makeSetup();
    await copyBassVoice({ services, sound, group, member });

    expect(host.setSceneData).toHaveBeenCalledWith('scene-1', 'track:db-new:bassVoice', {
      groupId: 'db-anchor',
      voiceIndex: 2,
      partition: 'low',
      label: 'low register (copy)',
    });
    // NO scene-data write mentions the source track.
    for (const call of host.setSceneData.mock.calls) {
      expect(call[1]).not.toContain('db-src');
    }
    // Voice-count math tolerates index gaps (0,2 → 3).
    const gappy = makeSetup({ members: [makeMember(0), makeMember(2, 'db-x', 'eng-x')] });
    await copyBassVoice({ services: gappy.services, sound: gappy.sound, group: gappy.group, member: gappy.member });
    const meta = gappy.host.setSceneData.mock.calls[0][2] as BassVoiceMeta;
    expect(meta.voiceIndex).toBe(3);
  });

  it('spawns the copy MUTED and reloads', async () => {
    const { host, sound, group, services, member } = makeSetup();
    await copyBassVoice({ services, sound, group, member });
    expect(host.setTrackMute).toHaveBeenCalledWith('eng-new', true);
    expect(host.setTrackRole).toHaveBeenCalledWith('eng-new', 'bass');
    expect(services.reloadTracks).toHaveBeenCalledWith(true);
    expect(host.showToast).toHaveBeenCalledWith('success', 'Voice copied', 'low register (copy)');
  });
});

describe('copyBassVoice — guards and rollback', () => {
  it('rolls back the half-made copy on failure (LIFO: track + meta key)', async () => {
    const { host, sound, group, services, member } = makeSetup({
      host: { writeMidiClip: jest.fn(async () => { throw new Error('engine down'); }) },
    });
    await copyBassVoice({ services, sound, group, member });

    expect(host.deleteTrack).toHaveBeenCalledWith('eng-new');
    expect(host.deleteSceneData).toHaveBeenCalledWith('scene-1', 'track:db-new:bassVoice');
    expect(host.showToast).toHaveBeenCalledWith('error', 'Copy failed', 'engine down');
    expect(services.reloadTracks).not.toHaveBeenCalled();
  });

  it('refuses at the track budget', async () => {
    const { host, sound, group, services, member } = makeSetup({ trackCount: 16 });
    await copyBassVoice({ services, sound, group, member });
    expect(host.createTrack).not.toHaveBeenCalled();
    expect(host.showToast).toHaveBeenCalledWith('warning', 'Track limit reached');
  });

  it('refuses cleanly on hosts without readMidiNotes', async () => {
    const { host, sound, group, services, member } = makeSetup({ host: { readMidiNotes: undefined } });
    await copyBassVoice({ services, sound, group, member });
    expect(host.createTrack).not.toHaveBeenCalled();
    expect(host.showToast).toHaveBeenCalledWith(
      'error',
      'Copy failed',
      'This host cannot read voice MIDI (update the app).',
    );
  });
});
