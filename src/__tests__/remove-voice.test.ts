/**
 * Per-voice removal: the pure plan and the anchor-handoff surgery (a
 * bassline has no config blob, so non-anchor deletes write nothing).
 */

import { planVoiceRemoval, prepareVoiceRemoval, type VoiceRemovalMember } from '../remove-voice';
import { BASS_VOICE_META_KEY, type BassVoiceMeta } from '../bass-voice-meta';

const keyFor = (dbId: string, suffix: string): string => `track:${dbId}:${suffix}`;

function member(
  dbId: string,
  voiceIndex: number,
  overrides: Partial<BassVoiceMeta> = {},
): VoiceRemovalMember {
  return {
    dbId,
    meta: { groupId: 'a', voiceIndex, partition: 'low', label: `v${voiceIndex}`, ...overrides },
  };
}

function makeStubHost(initial: Record<string, unknown> = {}): {
  data: Map<string, unknown>;
  host: { getSceneData: jest.Mock; setSceneData: jest.Mock };
} {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    host: {
      getSceneData: jest.fn(async (_scene: string, key: string) => data.get(key) ?? null),
      setSceneData: jest.fn(async (_scene: string, key: string, value: unknown) => {
        data.set(key, value);
      }),
    },
  };
}

describe('planVoiceRemoval', () => {
  it('drops the deleted member and keeps voiceIndex order', () => {
    const plan = planVoiceRemoval([member('c', 2), member('a', 0), member('b', 1)], 'b');
    expect(plan.survivors.map((m) => m.dbId)).toEqual(['a', 'c']);
    expect(plan.anchorDbId).toBe('a');
    expect(plan.newAnchorDbId).toBeNull();
  });

  it('promotes the lowest surviving voice when the anchor is deleted', () => {
    const plan = planVoiceRemoval([member('a', 0), member('b', 1), member('c', 2)], 'a');
    expect(plan.newAnchorDbId).toBe('b');
  });

  it('reports no handoff when the last voice is deleted', () => {
    const plan = planVoiceRemoval([member('a', 0)], 'a');
    expect(plan.survivors).toEqual([]);
    expect(plan.newAnchorDbId).toBeNull();
  });
});

describe('prepareVoiceRemoval', () => {
  const members = [
    member('a', 0, { partition: 'low' }),
    member('b', 1, { partition: 'mid' }),
    member('c', 2, { partition: 'high' }),
  ];

  it('writes nothing on a non-anchor delete (a ⧉-copied voice included)', async () => {
    const { host } = makeStubHost({ [keyFor('a', 'prompt')]: 'rolling acid line' });
    await prepareVoiceRemoval({ host, sceneId: 's', keyFor, members, deletedDbId: 'c' });
    expect(host.setSceneData).not.toHaveBeenCalled();
    expect(host.getSceneData).not.toHaveBeenCalled();
  });

  it('hands the group to the next voice when the anchor is deleted', async () => {
    const { data, host } = makeStubHost({
      [keyFor('a', 'prompt')]: 'rolling acid line',
    });
    await prepareVoiceRemoval({ host, sceneId: 's', keyFor, members, deletedDbId: 'a' });

    expect(data.get(keyFor('b', 'prompt'))).toBe('rolling acid line');

    // Survivors re-pointed; the new anchor takes voiceIndex 0; partition +
    // label are preserved (they describe the CONTENT, which didn't change).
    expect(data.get(keyFor('b', BASS_VOICE_META_KEY))).toEqual<BassVoiceMeta>({
      groupId: 'b',
      voiceIndex: 0,
      partition: 'mid',
      label: 'v1',
    });
    expect(data.get(keyFor('c', BASS_VOICE_META_KEY))).toEqual<BassVoiceMeta>({
      groupId: 'b',
      voiceIndex: 2,
      partition: 'high',
      label: 'v2',
    });
  });

  it('skips the prompt copy when the anchor prompt is empty but still re-points', async () => {
    const { data, host } = makeStubHost();
    await prepareVoiceRemoval({ host, sceneId: 's', keyFor, members, deletedDbId: 'a' });
    expect(data.has(keyFor('b', 'prompt'))).toBe(false);
    expect(data.get(keyFor('b', BASS_VOICE_META_KEY))).toMatchObject({ groupId: 'b', voiceIndex: 0 });
  });

  it('is a no-op for the last voice and for a missing selector', async () => {
    const solo = makeStubHost({ [keyFor('a', 'prompt')]: 'dub bass' });
    await prepareVoiceRemoval({
      host: solo.host,
      sceneId: 's',
      keyFor,
      members: [member('a', 0)],
      deletedDbId: 'a',
    });
    expect(solo.host.setSceneData).not.toHaveBeenCalled();

    const miss = makeStubHost();
    await prepareVoiceRemoval({ host: miss.host, sceneId: 's', keyFor, members, deletedDbId: 'zzz' });
    expect(miss.host.setSceneData).not.toHaveBeenCalled();
  });
});
