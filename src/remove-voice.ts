/**
 * Per-voice removal — the "delete ONE voice" counterpart of the group ✕.
 *
 * A bassline has no stored voice-count config (the partition is derived
 * from the generated line), so deleting a non-anchor voice — including a
 * ⧉-copied voice — is just a track delete; the group renders thinner and
 * the next Generate re-partitions from scratch. Deleting the ANCHOR
 * (voice 0) additionally hands the group identity to the next surviving
 * voice: the prompt moves to the new anchor's key and every survivor's
 * meta is re-pointed (groupId = new anchor dbId, new anchor takes
 * voiceIndex 0) BEFORE the old anchor's track and keys are scrubbed — the
 * group must never reload through an anchorless (degraded-to-loose-rows)
 * state.
 *
 * The caller runs this surgery FIRST, then `ctx.deleteGroup([deleted], …)`
 * with the same suffix list the whole-group ✕ uses: the anchor-held prompt
 * either moved here already or belongs to the last remaining voice.
 */

import { BASS_VOICE_META_KEY, type BassVoiceMeta } from './bass-voice-meta';

/** The slice of PluginHost the surgery needs (kept narrow for tests). */
export interface VoiceRemovalHost {
  getSceneData(sceneId: string, key: string): Promise<unknown>;
  setSceneData(sceneId: string, key: string, value: unknown): Promise<void>;
}

export interface VoiceRemovalMember {
  dbId: string;
  meta: BassVoiceMeta;
}

export interface VoiceRemovalPlan {
  /** Members left after the delete, sorted by voiceIndex. */
  survivors: VoiceRemovalMember[];
  /** The group's anchor BEFORE the delete (voiceIndex 0, or first member). */
  anchorDbId: string | null;
  /** Set when the anchor itself is deleted and survivors remain. */
  newAnchorDbId: string | null;
}

export function planVoiceRemoval(
  members: VoiceRemovalMember[],
  deletedDbId: string,
): VoiceRemovalPlan {
  const sorted = [...members].sort((a, b) => a.meta.voiceIndex - b.meta.voiceIndex);
  const anchor = sorted.find((m) => m.meta.voiceIndex === 0) ?? sorted[0];
  const survivors = sorted.filter((m) => m.dbId !== deletedDbId);
  const anchorDeleted = anchor !== undefined && anchor.dbId === deletedDbId;
  return {
    survivors,
    anchorDbId: anchor?.dbId ?? null,
    newAnchorDbId: anchorDeleted && survivors.length > 0 ? survivors[0].dbId : null,
  };
}

/**
 * Scene-data surgery for removing one voice. Only the anchor-handoff case
 * writes anything (there is no bass config to shrink); a non-anchor delete,
 * the last voice, and a missed selector are all no-ops here.
 */
export async function prepareVoiceRemoval(opts: {
  host: VoiceRemovalHost;
  sceneId: string;
  keyFor: (dbId: string, suffix: string) => string;
  members: VoiceRemovalMember[];
  deletedDbId: string;
}): Promise<void> {
  const { host, sceneId, keyFor, members, deletedDbId } = opts;
  const plan = planVoiceRemoval(members, deletedDbId);
  if (plan.survivors.length === members.length) return; // selector missed
  if (plan.survivors.length === 0 || plan.anchorDbId === null) return; // last voice
  if (!plan.newAnchorDbId) return; // non-anchor delete: nothing to re-point

  const prompt = await host.getSceneData(sceneId, keyFor(plan.anchorDbId, 'prompt'));
  if (typeof prompt === 'string' && prompt.trim() !== '') {
    await host.setSceneData(sceneId, keyFor(plan.newAnchorDbId, 'prompt'), prompt);
  }
  for (const s of plan.survivors) {
    const meta: BassVoiceMeta = {
      ...s.meta,
      groupId: plan.newAnchorDbId,
      voiceIndex: s.dbId === plan.newAnchorDbId ? 0 : s.meta.voiceIndex,
    };
    await host.setSceneData(sceneId, keyFor(s.dbId, BASS_VOICE_META_KEY), meta);
  }
}
