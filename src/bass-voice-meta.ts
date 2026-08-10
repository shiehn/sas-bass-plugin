/**
 * Bass voice-group metadata + the reconcile planner.
 *
 * A bassline group is N normal tracks linked by per-member scene-data keys
 * `track:<dbId>:bassVoice` sharing a groupId — the SDK's generic group seam
 * (the crossfade pattern). The ANCHOR is voice 0: its track carries the
 * group's bassline prompt under the standard `track:<dbId>:prompt` key and
 * `groupId === anchorDbId`. All keys are DB-UUID based (never engine ids).
 */

import type {
  GroupParseSpec,
  ResolvedTrackGroup,
  GeneratorTrackState,
  PluginHost,
} from '@signalsandsorcery/plugin-sdk';
import type { BassPartition } from './split-bass-line';

export const BASS_VOICE_META_KEY = 'bassVoice';

export interface BassVoiceMeta {
  /** dbId of the anchor (voice 0) track. */
  groupId: string;
  voiceIndex: number;
  partition: BassPartition;
  /** Human partition label shown in the voice row's prompt field. */
  label: string;
}

/** Defensive narrow (the asCrossfadeMeta pattern — survives partial blobs). */
export function asBassVoiceMeta(val: unknown): BassVoiceMeta | null {
  if (!val || typeof val !== 'object') return null;
  const m = val as Partial<BassVoiceMeta>;
  if (typeof m.groupId !== 'string' || typeof m.voiceIndex !== 'number') return null;
  return {
    groupId: m.groupId,
    voiceIndex: m.voiceIndex,
    partition: (typeof m.partition === 'string' ? m.partition : 'single') as BassPartition,
    label: typeof m.label === 'string' ? m.label : '',
  };
}

/** Group parse spec for the SDK's generic group seam. */
export const bassVoiceGroupSpec: GroupParseSpec<BassVoiceMeta> = {
  metaKey: BASS_VOICE_META_KEY,
  asMeta: asBassVoiceMeta,
  groupIdOf: (m) => m.groupId,
  sortMembers: (a, b) => a.meta.voiceIndex - b.meta.voiceIndex,
};

/**
 * Completeness policy: the ANCHOR (voice 0) must be live. A group missing a
 * non-anchor member stays alive (thinner line — reconcile heals it); a group
 * missing its anchor degrades to normal rows (no prompt identity left).
 */
export function bassGroupIsComplete(
  group: ResolvedTrackGroup<BassVoiceMeta, GeneratorTrackState>,
): boolean {
  return group.members.some((m) => m.meta.voiceIndex === 0);
}

// ---------------------------------------------------------------------------
// Anchor stamp (Import Track)
// ---------------------------------------------------------------------------

/** Voice label an imported one-voice bassline shows — the single-partition wording. */
export const IMPORTED_VOICE_LABEL = 'full line';

/**
 * Make an IMPORTED track a bassline group of ONE (anchor, voiceIndex 0).
 *
 * Two arrival paths, both needing this:
 *
 *   - cross-scene import (`host.importTrack`) copies every
 *     `track:<sourceDbId>:*` key with the VALUES untouched, so the copy still
 *     carries the source scene's `bassVoice` meta — a groupId naming an anchor
 *     that does not exist in this scene, and possibly `voiceIndex: 2`. Left
 *     alone it resolves to an anchor-less (incomplete) group and degrades to a
 *     loose row. Writing over it is the whole point: one track, one group, and
 *     `groupId === anchorDbId` holds again.
 *   - cross-panel port copies MIDI only onto a brand-new track, which has no
 *     meta at all.
 *
 * Either way the result is a normal one-voice group: the header carries the
 * prompt (imported with the copy, or empty for a port) and Generate
 * re-partitions from scratch — reusing voice 0, so the imported preset
 * survives the first regeneration.
 */
export async function stampBassAnchor(
  host: Pick<PluginHost, 'setSceneData'>,
  sceneId: string,
  keyFor: (dbId: string, suffix: string) => string,
  dbId: string,
): Promise<void> {
  const meta: BassVoiceMeta = {
    groupId: dbId,
    voiceIndex: 0,
    partition: 'single',
    label: IMPORTED_VOICE_LABEL,
  };
  await host.setSceneData(sceneId, keyFor(dbId, BASS_VOICE_META_KEY), meta);
}

// ---------------------------------------------------------------------------
// Reconcile planner (pure)
// ---------------------------------------------------------------------------

export interface ReconcileMember {
  dbId: string;
  engineId: string;
  voiceIndex: number;
}

export interface ReconcilePlan {
  /** Existing members paired positionally with new buckets — clip replaced, PRESET KEPT. */
  reuse: Array<{ dbId: string; engineId: string; bucketIndex: number }>;
  /** Bucket indexes needing fresh tracks (created in order). */
  createBucketIndexes: number[];
  /** Surplus members to delete (tracks + their bassVoice keys). */
  remove: Array<{ dbId: string; engineId: string }>;
}

/**
 * Pair surviving members (sorted by voiceIndex) positionally with the new
 * buckets. Reused voices keep their preset UNCONDITIONALLY — the user curates
 * sounds and regeneration must never clobber them. Because bucketCount ≥ 1,
 * index 0 (the anchor) is always reused, so the groupId and the prompt key
 * never move.
 */
export function planReconcile(existing: ReconcileMember[], bucketCount: number): ReconcilePlan {
  const sorted = [...existing].sort((a, b) => a.voiceIndex - b.voiceIndex);
  const reuse: ReconcilePlan['reuse'] = [];
  const createBucketIndexes: number[] = [];
  const remove: ReconcilePlan['remove'] = [];

  for (let i = 0; i < bucketCount; i++) {
    const member = sorted[i];
    if (member) reuse.push({ dbId: member.dbId, engineId: member.engineId, bucketIndex: i });
    else createBucketIndexes.push(i);
  }
  for (let i = bucketCount; i < sorted.length; i++) {
    remove.push({ dbId: sorted[i].dbId, engineId: sorted[i].engineId });
  }
  return { reuse, createBucketIndexes, remove };
}
