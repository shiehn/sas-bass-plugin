/**
 * The bass panel's generation strategy (PanelGenerationStrategy.generate).
 *
 * One group-level turn: LLM composes ONE monophonic line from the anchor's
 * prompt → deterministic validation (clip bounds → host 1/16 quantize →
 * monophony sweep → register fold) → mechanical splitBassLine (1–3 buckets)
 * → planReconcile against the existing group → execute:
 *
 *   reuse  : clip replaced, PRESET UNTOUCHED (user curation survives)
 *   create : track + clip FIRST, then host.shufflePreset with the names
 *            applied earlier in this pass excluded (distinct starting sounds;
 *            category selection stays purely mechanical — the host derives
 *            Basses-hi/low from the clip's REAL pitches)
 *   remove : surplus voice tracks + their bassVoice keys
 *
 * Ordering: clips before presets (range analysis needs real notes); metas
 * last; LIFO rollback of created tracks on failure. All scene-data keys are
 * dbId-based via services.trackDataKey.
 */

import type {
  GenerationServices,
  GeneratorTrackState,
  MidiClipData,
  PluginTrackHandle,
} from '@signalsandsorcery/plugin-sdk';
import { formatConcurrentTracks } from '@signalsandsorcery/plugin-sdk';
import { buildBassSystemPrompt } from './bass-system-prompt';
import {
  parseBassLine,
  clampToClip,
  enforceMonophony,
  foldToRegister,
} from './validate-bass-line';
import { analyzeBassVoices } from './variety-voice';
import {
  BASS_VOICE_META_KEY,
  bassVoiceGroupSpec,
  planReconcile,
  type BassVoiceMeta,
  type ReconcileMember,
} from './bass-voice-meta';

export const BASS_MAX_TRACKS = 16;

export async function generateBassline(
  track: GeneratorTrackState,
  services: GenerationServices,
): Promise<void> {
  const { host } = services;
  const scene = services.activeSceneId;
  if (!scene) throw new Error('No active scene.');

  // --- 1. Resolve the group this generation belongs to --------------------
  const groups = services.resolvedGroups<BassVoiceMeta>(BASS_VOICE_META_KEY);
  const promptedDbId = track.handle.dbId;
  const existingGroup = groups.find((g) => g.members.some((m) => m.dbId === promptedDbId)) ?? null;

  // Anchor: voice 0 of the group, or the prompted track itself pre-group.
  const anchorMember = existingGroup?.members.find((m) => m.meta.voiceIndex === 0);
  const anchorTrack: GeneratorTrackState = anchorMember ? anchorMember.track : track;
  const anchorDbId = anchorTrack.handle.dbId;

  const existingMembers: ReconcileMember[] = existingGroup
    ? existingGroup.members.map((m) => ({
        dbId: m.dbId,
        engineId: m.track.handle.id,
        voiceIndex: m.meta.voiceIndex,
      }))
    : [{ dbId: anchorDbId, engineId: anchorTrack.handle.id, voiceIndex: 0 }];
  const memberEngineIds = new Set(existingMembers.map((m) => m.engineId));
  const memberDbIds = new Set(existingMembers.map((m) => m.dbId));

  // --- 2. Context bundle ---------------------------------------------------
  const musicalContext = await host.getMusicalContext();
  const generationContext = await host.getGenerationContext(anchorTrack.handle.id);
  // The host auto-excludes only ONE track id — on regeneration the group's
  // own voices must not appear as "concurrent tracks" the LLM writes around.
  generationContext.concurrentTracks = generationContext.concurrentTracks.filter(
    (t) => !memberEngineIds.has(t.trackId) && !memberDbIds.has(t.trackId),
  );
  const concurrentBlock = formatConcurrentTracks(generationContext);

  const promptParts: string[] = [];
  if (concurrentBlock) {
    promptParts.push(concurrentBlock, '');
  }
  promptParts.push(
    `User request: "${track.prompt}"`,
    ``,
    `Compose the bassline now — output the JSON.`,
  );
  const userPrompt = promptParts.join('\n');

  // --- 3. LLM --------------------------------------------------------------
  const llmResult = await host.generateWithLLM({
    system: buildBassSystemPrompt(),
    user: userPrompt,
    responseFormat: 'json',
  });

  // --- 4. Deterministic validation ----------------------------------------
  const parsed = parseBassLine(llmResult.content);
  if (!parsed) throw new Error('LLM returned no valid bassline');
  let notes = clampToClip(parsed, musicalContext.bars);
  if (notes.length === 0) throw new Error('Bassline fell outside the clip');
  notes = await host.postProcessMidi(notes, {
    quantize: true,
    quantizeGrid: '1/16',
    removeOverlaps: false, // the global monophony sweep below supersedes it
  });
  notes = enforceMonophony(notes);
  notes = foldToRegister(notes);
  if (notes.length === 0) throw new Error('Bassline validation left no notes');

  // --- 5. Mechanical split → 1–3 voice buckets -----------------------------
  // Primary register/metric split + the repetition-driven variety voice
  // (symmetric timbre variety at 4-bar boundaries on long repetitive lines).
  const buckets = analyzeBassVoices(notes, musicalContext.bars);

  // --- 6. Reconcile plan + track budget ------------------------------------
  const plan = planReconcile(existingMembers, buckets.length);
  const liveCount = services.tracks.length;
  if (liveCount - plan.remove.length + plan.createBucketIndexes.length > BASS_MAX_TRACKS) {
    throw new Error('Not enough track slots for the bassline voices.');
  }

  // --- 7. Execute -----------------------------------------------------------
  const clipFor = (bucketNotes: MidiClipData['notes']): MidiClipData => ({
    startTime: 0,
    endTime: (musicalContext.bars * 4 * 60) / musicalContext.bpm,
    tempo: musicalContext.bpm,
    notes: bucketNotes,
  });

  const created: PluginTrackHandle[] = [];
  try {
    // Pair every bucket with its member (reused or freshly created, in order).
    const memberByBucket = new Map<number, { engineId: string; dbId: string; isNew: boolean }>();
    for (const r of plan.reuse) {
      memberByBucket.set(r.bucketIndex, { engineId: r.engineId, dbId: r.dbId, isNew: false });
    }
    for (const bucketIndex of plan.createBucketIndexes) {
      const handle = await services.createFamilyTrack(`-v${bucketIndex}`);
      created.push(handle);
      memberByBucket.set(bucketIndex, { engineId: handle.id, dbId: handle.dbId, isNew: true });
    }

    // Clips FIRST (preset range analysis reads real pitches), then role+mute.
    for (let i = 0; i < buckets.length; i++) {
      const member = memberByBucket.get(i)!;
      await host.writeMidiClip(member.engineId, clipFor(buckets[i].notes));
      await host.setTrackRole(member.engineId, 'bass').catch(() => {});
      // Fresh generations mute by default (same contract as the synth panel).
      await host.setTrackMute(member.engineId, true).catch(() => {});
      if (!member.isNew) {
        services.updateTrack(member.engineId, (t) => ({
          ...t,
          runtimeState: { ...t.runtimeState, muted: true },
        }));
      }
    }

    // Starting presets for NEW voices only — reused voices keep the user's
    // pick. Exclude the names applied earlier in THIS pass so two new voices
    // don't spawn with the identical patch. Non-fatal: a failed pick leaves
    // the default Surge patch.
    const appliedNames: string[] = [];
    for (let i = 0; i < buckets.length; i++) {
      const member = memberByBucket.get(i)!;
      if (!member.isNew) continue;
      try {
        const result = await host.shufflePreset(member.engineId, appliedNames);
        appliedNames.push(result.presetName);
      } catch {
        /* non-fatal — default patch */
      }
    }

    // Metas last (a mid-flight failure above leaves the OLD group intact).
    for (let i = 0; i < buckets.length; i++) {
      const member = memberByBucket.get(i)!;
      const meta: BassVoiceMeta = {
        groupId: anchorDbId,
        voiceIndex: i,
        partition: buckets[i].partition,
        label: buckets[i].label,
      };
      await host.setSceneData(scene, services.trackDataKey(member.dbId, BASS_VOICE_META_KEY), meta);
    }

    // Surplus voices: tracks + their group keys. (Their prompt keys don't
    // exist — only the anchor carries a prompt — but delete defensively.)
    for (const surplus of plan.remove) {
      await host.deleteTrack(surplus.engineId).catch(() => {});
      await host
        .deleteSceneData(scene, services.trackDataKey(surplus.dbId, BASS_VOICE_META_KEY))
        .catch(() => {});
      await host
        .deleteSceneData(scene, services.trackDataKey(surplus.dbId, 'soundHistory'))
        .catch(() => {});
    }
  } catch (err) {
    // LIFO rollback — remove any voice tracks created this pass.
    for (const handle of [...created].reverse()) {
      try {
        await host.deleteTrack(handle.id);
      } catch {
        /* best effort */
      }
      await host
        .deleteSceneData(scene, services.trackDataKey(handle.dbId, BASS_VOICE_META_KEY))
        .catch(() => {});
    }
    throw err instanceof Error ? err : new Error(String(err));
  }

  // --- 8. Success patch on the anchor row ----------------------------------
  services.updateTrack(anchorTrack.handle.id, (t) => ({
    ...t,
    isGenerating: false,
    error: null,
    role: 'bass',
    hasMidi: true,
    generationProgress: 0,
    editNotes: buckets[0].notes,
    editBars: musicalContext.bars,
    editBpm: musicalContext.bpm,
  }));
  services.markEditLoaded(anchorTrack.handle.id);
  host.showToast(
    'success',
    'Bassline generated',
    buckets.length === 1 ? '1 voice' : `${buckets.length} voices (${buckets.map((b) => b.partition).join(' / ')})`,
  );
  await services.reloadTracks(true);
}

export { bassVoiceGroupSpec };
