/**
 * Voice-group meta narrowing, group-seam wiring, and the reconcile planner.
 */

import { parseTrackGroups, resolveTrackGroups } from '@signalsandsorcery/plugin-sdk';
import type { GeneratorTrackState } from '@signalsandsorcery/plugin-sdk';
import {
  asBassVoiceMeta,
  bassVoiceGroupSpec,
  bassGroupIsComplete,
  planReconcile,
  BASS_VOICE_META_KEY,
  type BassVoiceMeta,
} from '../bass-voice-meta';

function meta(groupId: string, voiceIndex: number, partition = 'downbeats', label = 'downbeats (1,2,3,4)'): BassVoiceMeta {
  return { groupId, voiceIndex, partition: partition as BassVoiceMeta['partition'], label };
}

function fakeTrack(id: string, dbId: string): GeneratorTrackState {
  return { handle: { id, dbId, name: id } } as unknown as GeneratorTrackState;
}

describe('asBassVoiceMeta', () => {
  it('narrows valid metas and defaults partition/label', () => {
    expect(asBassVoiceMeta({ groupId: 'a', voiceIndex: 1 })).toEqual({
      groupId: 'a',
      voiceIndex: 1,
      partition: 'single',
      label: '',
    });
    expect(asBassVoiceMeta(meta('a', 0, 'low', 'low register'))).toEqual(meta('a', 0, 'low', 'low register'));
  });

  it('rejects garbage', () => {
    expect(asBassVoiceMeta(null)).toBeNull();
    expect(asBassVoiceMeta('x')).toBeNull();
    expect(asBassVoiceMeta({ groupId: 'a' })).toBeNull();
    expect(asBassVoiceMeta({ voiceIndex: 0 })).toBeNull();
  });
});

describe('group seam wiring', () => {
  const sceneData: Record<string, unknown> = {
    [`track:db-2:${BASS_VOICE_META_KEY}`]: meta('db-0', 2, 'offbeats-16th', '16th offbeats (e,a)'),
    [`track:db-0:${BASS_VOICE_META_KEY}`]: meta('db-0', 0),
    [`track:db-1:${BASS_VOICE_META_KEY}`]: meta('db-0', 1, 'offbeats-8th', '8th offbeats (&)'),
    'track:db-0:prompt': 'pumping 16th bass',
  };

  it('parses + sorts members by voiceIndex', () => {
    const groups = parseTrackGroups(sceneData, bassVoiceGroupSpec);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupId).toBe('db-0');
    expect(groups[0].members.map((m) => m.meta.voiceIndex)).toEqual([0, 1, 2]);
  });

  it('anchor present → complete even with a member missing; anchor gone → degrade', () => {
    const groups = parseTrackGroups(sceneData, bassVoiceGroupSpec);
    const withAnchor = resolveTrackGroups(
      groups,
      [fakeTrack('eng-0', 'db-0'), fakeTrack('eng-2', 'db-2')],
      (t) => t.handle.dbId,
      { isComplete: (g) => bassGroupIsComplete(g as never) },
    );
    expect(withAnchor.resolved).toHaveLength(1);
    expect(withAnchor.resolved[0].members.map((m) => m.dbId)).toEqual(['db-0', 'db-2']);

    const withoutAnchor = resolveTrackGroups(
      groups,
      [fakeTrack('eng-1', 'db-1'), fakeTrack('eng-2', 'db-2')],
      (t) => t.handle.dbId,
      { isComplete: (g) => bassGroupIsComplete(g as never) },
    );
    expect(withoutAnchor.resolved).toHaveLength(0);
    expect(withoutAnchor.staleMemberDbIds).toEqual(['db-0']);
  });
});

describe('planReconcile', () => {
  const m = (dbId: string, engineId: string, voiceIndex: number) => ({ dbId, engineId, voiceIndex });

  it('1 → 3: reuses the anchor, creates buckets 1 and 2', () => {
    const plan = planReconcile([m('db-0', 'eng-0', 0)], 3);
    expect(plan.reuse).toEqual([{ dbId: 'db-0', engineId: 'eng-0', bucketIndex: 0 }]);
    expect(plan.createBucketIndexes).toEqual([1, 2]);
    expect(plan.remove).toEqual([]);
  });

  it('3 → 1: reuses the anchor, removes the surplus voices', () => {
    const plan = planReconcile([m('db-0', 'eng-0', 0), m('db-1', 'eng-1', 1), m('db-2', 'eng-2', 2)], 1);
    expect(plan.reuse).toEqual([{ dbId: 'db-0', engineId: 'eng-0', bucketIndex: 0 }]);
    expect(plan.createBucketIndexes).toEqual([]);
    expect(plan.remove.map((r) => r.dbId)).toEqual(['db-1', 'db-2']);
  });

  it('2 → 2: pure reuse (presets kept), nothing created or removed', () => {
    const plan = planReconcile([m('db-0', 'eng-0', 0), m('db-1', 'eng-1', 1)], 2);
    expect(plan.reuse).toHaveLength(2);
    expect(plan.createBucketIndexes).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('sorts unsorted members by voiceIndex before pairing (anchor always reused)', () => {
    const plan = planReconcile([m('db-2', 'eng-2', 2), m('db-0', 'eng-0', 0), m('db-1', 'eng-1', 1)], 2);
    expect(plan.reuse.map((r) => r.dbId)).toEqual(['db-0', 'db-1']);
    expect(plan.remove.map((r) => r.dbId)).toEqual(['db-2']);
  });

  it('heals a gap left by a manually deleted middle voice', () => {
    // Voice 1 was deleted out-of-band; survivors are voiceIndex 0 and 2.
    const plan = planReconcile([m('db-0', 'eng-0', 0), m('db-2', 'eng-2', 2)], 2);
    expect(plan.reuse.map((r) => [r.dbId, r.bucketIndex])).toEqual([
      ['db-0', 0],
      ['db-2', 1], // re-indexed densely
    ]);
    expect(plan.createBucketIndexes).toEqual([]);
    expect(plan.remove).toEqual([]);
  });
});
