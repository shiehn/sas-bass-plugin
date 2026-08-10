/**
 * stampBassAnchor — what makes an ARRIVING track (Import Bassline) a bassline
 * group of one.
 *
 * The interesting case is not the empty newborn (cross-panel port) but the
 * cross-scene copy: `host.importTrack` re-keys every `track:<sourceDbId>:*`
 * scene-data entry to the new dbId while leaving the VALUES untouched, so the
 * copy shows up still carrying the SOURCE scene's bassVoice meta. These tests
 * pin that the stamp overwrites it — and drive the result through the real
 * SDK group seam to prove the group resolves as complete.
 */

import { parseTrackGroups, resolveTrackGroups } from '@signalsandsorcery/plugin-sdk';
import type { GeneratorTrackState } from '@signalsandsorcery/plugin-sdk';
import {
  stampBassAnchor,
  bassVoiceGroupSpec,
  bassGroupIsComplete,
  BASS_VOICE_META_KEY,
  IMPORTED_VOICE_LABEL,
  type BassVoiceMeta,
} from '../bass-voice-meta';

/** The core's key builder (panel-helpers' trackDataKey), verbatim. */
const keyFor = (dbId: string, suffix: string): string => `track:${dbId}:${suffix}`;

function makeHost() {
  const store: Record<string, unknown> = {};
  return {
    store,
    setSceneData: jest.fn(async (_sceneId: string, key: string, value: unknown) => {
      store[key] = value;
    }),
  };
}

function fakeTrack(id: string, dbId: string): GeneratorTrackState {
  return { handle: { id, dbId, name: id } } as unknown as GeneratorTrackState;
}

describe('stampBassAnchor', () => {
  it('writes an anchor-of-one keyed to the NEWBORN dbId', async () => {
    const host = makeHost();
    await stampBassAnchor(host, 'scene-dest', keyFor, 'db-new');

    expect(host.setSceneData).toHaveBeenCalledTimes(1);
    expect(host.setSceneData).toHaveBeenCalledWith(
      'scene-dest',
      `track:db-new:${BASS_VOICE_META_KEY}`,
      { groupId: 'db-new', voiceIndex: 0, partition: 'single', label: IMPORTED_VOICE_LABEL },
    );
  });

  it('holds the groupId === anchorDbId invariant', async () => {
    const host = makeHost();
    await stampBassAnchor(host, 'scene-dest', keyFor, 'db-new');
    const meta = host.store[`track:db-new:${BASS_VOICE_META_KEY}`] as BassVoiceMeta;
    expect(meta.groupId).toBe('db-new');
    expect(meta.voiceIndex).toBe(0);
  });
});

describe('imported copy → a complete group of one', () => {
  // What the host's copy leaves behind: the SOURCE scene's meta, re-keyed to
  // the new dbId but still naming the source anchor — here voice 2 of a
  // three-voice bassline in another scene.
  const copiedFromSource = (): Record<string, unknown> => ({
    [`track:db-new:${BASS_VOICE_META_KEY}`]: {
      groupId: 'db-source-anchor',
      voiceIndex: 2,
      partition: 'offbeats-16th',
      label: '16th offbeats (e,a)',
    },
    'track:db-new:prompt': 'pumping 16th bass',
  });

  const resolveOne = (sceneData: Record<string, unknown>) =>
    resolveTrackGroups(
      parseTrackGroups(sceneData, bassVoiceGroupSpec),
      [fakeTrack('eng-new', 'db-new')],
      (t) => t.handle.dbId,
      { isComplete: (g) => bassGroupIsComplete(g as never) },
    );

  it('WITHOUT the stamp the copy degrades to a loose row (regression guard)', () => {
    // The copy is a lone voice 2 under a groupId no track here answers to →
    // anchor-less → incomplete → renders as a plain TrackRow, not a bassline.
    // This is the bug the stamp exists to prevent.
    const result = resolveOne(copiedFromSource());
    expect(result.resolved).toHaveLength(0);
  });

  it('WITH the stamp it resolves as one complete single-voice bassline', async () => {
    const sceneData = copiedFromSource();
    const host = {
      setSceneData: async (_sceneId: string, key: string, value: unknown) => {
        sceneData[key] = value;
      },
    };
    await stampBassAnchor(host, 'scene-dest', keyFor, 'db-new');

    const result = resolveOne(sceneData);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].groupId).toBe('db-new');
    expect(result.resolved[0].members).toHaveLength(1);
    expect(result.resolved[0].members[0].meta.voiceIndex).toBe(0);
    expect(result.staleMemberDbIds).toEqual([]);
    // The imported prompt survives — it is the group header's prompt.
    expect(sceneData['track:db-new:prompt']).toBe('pumping 16th bass');
  });

  it('two imports from the same source group land as two separate basslines', async () => {
    // Both copies carry groupId 'db-source-anchor'; unstamped they would merge
    // into one phantom group. Stamped, each owns itself.
    const sceneData: Record<string, unknown> = {};
    const host = {
      setSceneData: async (_sceneId: string, key: string, value: unknown) => {
        sceneData[key] = value;
      },
    };
    for (const dbId of ['db-a', 'db-b']) {
      sceneData[`track:${dbId}:${BASS_VOICE_META_KEY}`] = {
        groupId: 'db-source-anchor',
        voiceIndex: 1,
        partition: 'high',
        label: 'high register',
      };
      await stampBassAnchor(host, 'scene-dest', keyFor, dbId);
    }

    const result = resolveTrackGroups(
      parseTrackGroups(sceneData, bassVoiceGroupSpec),
      [fakeTrack('eng-a', 'db-a'), fakeTrack('eng-b', 'db-b')],
      (t) => t.handle.dbId,
      { isComplete: (g) => bassGroupIsComplete(g as never) },
    );
    expect(result.resolved.map((g) => g.groupId).sort()).toEqual(['db-a', 'db-b']);
    expect(result.resolved.every((g) => g.members.length === 1)).toBe(true);
  });
});
