/**
 * Bass transition-group adapter — subject collapse, member expansion, and
 * group-meta round-trip against a mock host.
 */

import type { PluginHost, SceneFamilyTrack } from '@signalsandsorcery/plugin-sdk';
import { createBassTransitionGroupAdapter, bassGroupLabel } from '../bass-transition';
import { BASS_VOICE_META_KEY, type BassVoiceMeta } from '../bass-voice-meta';

const SCENE = 'scene-from';

function voiceMeta(groupId: string, voiceIndex: number, label = ''): BassVoiceMeta {
  return { groupId, voiceIndex, partition: 'low', label };
}

interface MockHostState {
  sceneData: Record<string, unknown>;
  familyTracks: SceneFamilyTrack[];
  written: Array<{ sceneId: string; key: string; value: unknown }>;
}

function mockHost(state: MockHostState): PluginHost {
  return {
    getAllSceneData: jest.fn(async (sceneId: string) =>
      sceneId === SCENE ? state.sceneData : {},
    ),
    listSceneFamilyTracks: jest.fn(async (sceneId: string) =>
      sceneId === SCENE ? state.familyTracks : [],
    ),
    setSceneData: jest.fn(async (sceneId: string, key: string, value: unknown) => {
      state.written.push({ sceneId, key, value });
    }),
  } as unknown as PluginHost;
}

/** Two-voice group (g1) + one loose bass track. */
function makeState(): MockHostState {
  return {
    sceneData: {
      [`track:g1-v0:${BASS_VOICE_META_KEY}`]: voiceMeta('g1-v0', 0, 'low'),
      [`track:g1-v1:${BASS_VOICE_META_KEY}`]: voiceMeta('g1-v0', 1, 'offbeats'),
      'track:g1-v0:prompt': 'dark rolling bassline',
    },
    familyTracks: [
      { dbId: 'g1-v0', name: 'bass-1-v0', role: 'bass', prompt: 'dark rolling bassline' },
      { dbId: 'g1-v1', name: 'bass-1-v1', role: 'bass' },
      { dbId: 'loose-1', name: 'bass-loose', role: 'bass' },
    ],
    written: [],
  };
}

describe('bassGroupLabel', () => {
  it('pluralizes voices', () => {
    expect(bassGroupLabel(1)).toBe('Bassline (1 voice)');
    expect(bassGroupLabel(3)).toBe('Bassline (3 voices)');
  });
});

describe('mapColumnSubjects', () => {
  it('collapses a voice group to ONE anchor-addressed subject and passes loose tracks through', async () => {
    const state = makeState();
    const adapter = createBassTransitionGroupAdapter(mockHost(state));

    const subjects = await adapter.mapColumnSubjects(SCENE, state.familyTracks);

    expect(subjects).toEqual([
      {
        dbId: 'g1-v0', // the ANCHOR's dbId — exclude/row keys stay source-exact
        name: 'Bassline (2 voices)',
        role: 'bass',
        prompt: 'dark rolling bassline',
      },
      { dbId: 'loose-1', name: 'bass-loose', role: 'bass' },
    ]);
  });

  it('drops groups with no live members and counts only live ones', async () => {
    const state = makeState();
    // A stale meta for a track that no longer exists.
    state.sceneData[`track:gone:${BASS_VOICE_META_KEY}`] = voiceMeta('gone', 0);
    // g1-v1's row vanished — the subject shrinks to 1 voice.
    state.familyTracks = state.familyTracks.filter((t) => t.dbId !== 'g1-v1');
    const adapter = createBassTransitionGroupAdapter(mockHost(state));

    const subjects = await adapter.mapColumnSubjects(SCENE, state.familyTracks);

    expect(subjects.map((s) => s.dbId)).toEqual(['g1-v0', 'loose-1']);
    expect(subjects[0].name).toBe('Bassline (1 voice)');
  });
});

describe('expandSubject', () => {
  it('expands the anchor dbId into voiceIndex-ordered members with labels + familyMeta', async () => {
    const state = makeState();
    const adapter = createBassTransitionGroupAdapter(mockHost(state));

    const members = await adapter.expandSubject(SCENE, 'g1-v0');

    expect(members).toEqual([
      {
        dbId: 'g1-v0',
        name: 'bass-1-v0',
        role: 'bass',
        memberIndex: 0,
        memberLabel: 'low',
        familyMeta: voiceMeta('g1-v0', 0, 'low'),
      },
      {
        dbId: 'g1-v1',
        name: 'bass-1-v1',
        role: 'bass',
        memberIndex: 1,
        memberLabel: 'offbeats',
        familyMeta: voiceMeta('g1-v0', 1, 'offbeats'),
      },
    ]);
  });

  it('expands a loose track to a single member', async () => {
    const state = makeState();
    const adapter = createBassTransitionGroupAdapter(mockHost(state));

    const members = await adapter.expandSubject(SCENE, 'loose-1');

    expect(members).toEqual([
      { dbId: 'loose-1', name: 'bass-loose', role: 'bass', memberIndex: 0 },
    ]);
  });

  it('returns [] for an unknown subject', async () => {
    const state = makeState();
    const adapter = createBassTransitionGroupAdapter(mockHost(state));
    expect(await adapter.expandSubject(SCENE, 'nope')).toEqual([]);
  });
});

describe('writeGroupMetas', () => {
  it('writes one bassVoice meta per copy sharing the NEW anchor groupId, partition/label round-tripped', async () => {
    const state = makeState();
    const adapter = createBassTransitionGroupAdapter(mockHost(state));
    const members = await adapter.expandSubject(SCENE, 'g1-v0');

    await adapter.writeGroupMetas(
      'scene-transition',
      [
        { newDbId: 'copy-a', member: members[0] },
        { newDbId: 'copy-b', member: members[1] },
      ],
      'copy-a',
    );

    expect(state.written).toEqual([
      {
        sceneId: 'scene-transition',
        key: `track:copy-a:${BASS_VOICE_META_KEY}`,
        value: { groupId: 'copy-a', voiceIndex: 0, partition: 'low', label: 'low' },
      },
      {
        sceneId: 'scene-transition',
        key: `track:copy-b:${BASS_VOICE_META_KEY}`,
        value: { groupId: 'copy-a', voiceIndex: 1, partition: 'low', label: 'offbeats' },
      },
    ]);
  });
});

describe('defaults', () => {
  it('staggers fade midpoints (out early, in late) and stays fade-only', () => {
    const adapter = createBassTransitionGroupAdapter(mockHost(makeState()));
    expect(adapter.fadeOnly).toBe(true);
    expect(adapter.defaultSliderPos?.('out')).toBe(0.35);
    expect(adapter.defaultSliderPos?.('in')).toBe(0.65);
    expect(adapter.cleanupKeySuffixes).toEqual([BASS_VOICE_META_KEY]);
  });
});
