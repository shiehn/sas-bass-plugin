/**
 * BassGeneratorPanel — UI for the @signalsandsorcery/bass-generator plugin.
 *
 * A thin GeneratorPanelAdapter over the SDK panel-core, differing from the
 * synth panel in exactly one structural way: generation is GROUP-shaped. One
 * bassline prompt (carried by the anchor track) produces ONE monophonic line
 * that a mechanical analyzer partitions across voice tracks (register or
 * metric split — see src/split-bass-line.ts), rendered as a stacked voice
 * group via the SDK's generic group seam:
 *
 *   - the group header carries the bassline prompt + Generate + group
 *     mute/solo/delete (ConfirmDialog-guarded)
 *   - voice rows are standard TrackRows whose prompt field shows the
 *     mechanical partition label; no per-voice Generate (the partition is
 *     derived — regenerate the group instead); full
 *     🎲 / sound-history / Pick / FX / piano-roll / mixer per voice
 *   - per-voice COPY (⧉) deep-copies a voice — same notes + preset by
 *     value, brand-new identity — appended to the group (no voice cap)
 *   - per-voice DELETE (✕, ConfirmDialog-guarded) removes just that voice;
 *     deleting the anchor hands the prompt + group identity to the next
 *     voice (src/remove-voice.ts) so the group never degrades
 *   - reused voices keep their preset on regeneration, ALWAYS
 *   - an IMPORTED bassline (header "Import Bassline" — cross-scene copy or
 *     cross-panel port) is stamped as a group of ONE by onTrackCreated, so a
 *     part that arrives from elsewhere reads and behaves like a generated one,
 *     and brings the source's Surge patch with it (src/port-sound.ts)
 *
 * Sound serialization + 🎲 are the same mechanical Surge paths the synth
 * panel uses (shared createSurgeSoundAdapter; role-driven host.shufflePreset
 * whose Basses-hi/low category comes from range analysis of the REAL notes).
 */

import React, { useMemo, useState } from 'react';
import type {
  PluginUIProps,
  PluginHost,
  PluginTrackHandle,
  GeneratorPanelAdapter,
  GeneratorTrackState,
  GroupRenderContext,
  PanelSoundAdapter,
  ResolvedTrackGroup,
} from '@signalsandsorcery/plugin-sdk';
import {
  GeneratorPanelShell,
  useGeneratorPanelCore,
  createSurgeSoundAdapter,
  ConfirmDialog,
  GroupCollapseChevron,
  useRegenerateGuard,
} from '@signalsandsorcery/plugin-sdk';
import { buildBassSystemPrompt } from './src/bass-system-prompt';
import { generateBassline, BASS_MAX_TRACKS } from './src/bass-generation';
import { copyBassVoice } from './src/copy-voice';
import { applyPortedBassSound } from './src/port-sound';
import { prepareVoiceRemoval } from './src/remove-voice';
import {
  BASS_VOICE_META_KEY,
  bassVoiceGroupSpec,
  bassGroupIsComplete,
  stampBassAnchor,
  type BassVoiceMeta,
} from './src/bass-voice-meta';
import { createBassTransitionGroupAdapter } from './src/bass-transition';
import { parseLLMNoteResponse, promptEnterToGenerate } from '@signalsandsorcery/plugin-sdk';

const ESTIMATED_GENERATION_MS = 15000;

// ============================================================================
// Voice group row
// ============================================================================

interface BassVoiceGroupRowProps {
  group: ResolvedTrackGroup<BassVoiceMeta, GeneratorTrackState>;
  ctx: GroupRenderContext;
  sound: PanelSoundAdapter;
}

function BassVoiceGroupRow({ group, ctx, sound }: BassVoiceGroupRowProps): React.ReactElement {
  const [confirmDelete, setConfirmDelete] = useState(false);
  // isComplete guarantees the anchor is live.
  const anchor = group.members.find((m) => m.meta.voiceIndex === 0) ?? group.members[0];
  const anchorTrack = anchor.track;
  const memberEngineIds = group.members.map((m) => m.track.handle.id);
  const allMuted = group.members.every((m) => m.track.runtimeState.muted);
  const anySoloed = group.members.some((m) => m.track.runtimeState.solo);
  const generateDisabled = anchorTrack.isGenerating || !anchorTrack.prompt.trim();

  // The group Generate drives the anchor directly (never through TrackRow), so
  // it carries its own overwrite guard: one press re-partitions EVERY voice.
  const regenerate = useRegenerateGuard({
    hasMidi: anchorTrack.hasMidi,
    onGenerate: () => ctx.handlers.generate(anchorTrack.handle.id),
    subject: 'The bassline',
    detail: `All ${group.members.length} ${
      group.members.length === 1 ? 'voice is' : 'voices are'
    } re-partitioned from the new line.`,
    testIdPrefix: `bass-group-regenerate-confirm-${group.groupId}`,
  });

  // Per-voice delete (TrackRow's own ConfirmDialog gates the click): anchor
  // handoff surgery first when voice 0 goes, then the track + key scrub.
  // Abort on surgery failure so the group is never left half-re-pointed with
  // the voice already gone.
  const handleVoiceDelete = (member: (typeof group.members)[number]): void => {
    void (async () => {
      const scene = ctx.services.activeSceneId;
      try {
        if (scene) {
          await prepareVoiceRemoval({
            host: ctx.services.host,
            sceneId: scene,
            keyFor: ctx.services.trackDataKey,
            members: group.members.map((gm) => ({ dbId: gm.dbId, meta: gm.meta })),
            deletedDbId: member.dbId,
          });
        }
      } catch (err) {
        ctx.services.host.showToast(
          'error',
          'Failed to delete voice',
          err instanceof Error ? err.message : String(err),
        );
        return;
      }
      await ctx.deleteGroup(
        [{ engineId: member.track.handle.id, dbId: member.dbId }],
        [BASS_VOICE_META_KEY, 'prompt', 'soundHistory', 'role', 'groupUi'],
      );
    })();
  };

  return (
    <div
      data-testid={`bass-group-${group.groupId}`}
      className="rounded-sm border border-sas-border bg-sas-panel-alt overflow-hidden"
      style={{ borderLeftColor: '#F97316', borderLeftWidth: '3px' }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-sas-border">
        <GroupCollapseChevron collapsed={ctx.collapsed} onToggle={ctx.onToggleCollapse} what="bassline" />
        <span className="text-[9px] uppercase tracking-wide text-sas-muted whitespace-nowrap">
          Bassline · {group.members.length} {group.members.length === 1 ? 'voice' : 'voices'}
        </span>
        <input
          data-testid={`bass-group-prompt-${group.groupId}`}
          className="flex-1 min-w-0 bg-sas-panel border border-sas-border rounded-sm px-2 py-0.5 text-xs text-sas-text placeholder:text-sas-muted/50 focus:border-sas-accent focus:outline-none"
          value={anchorTrack.prompt}
          placeholder="Describe the bassline…"
          onChange={(e) => ctx.handlers.promptChange(anchorTrack.handle.id, e.target.value)}
          onKeyDown={promptEnterToGenerate(regenerate.request, generateDisabled)}
        />
        <button
          data-testid={`bass-group-generate-${group.groupId}`}
          disabled={generateDisabled}
          onClick={regenerate.request}
          title={
            anchorTrack.hasMidi
              ? 'Regenerate the bassline — replaces the current MIDI'
              : 'Generate the bassline'
          }
          className={`px-2 py-0.5 text-[10px] font-medium rounded-sm border transition-colors ${
            generateDisabled
              ? 'bg-sas-panel border-sas-border text-sas-muted/50 cursor-not-allowed'
              : 'bg-sas-accent/10 border-sas-accent/30 text-sas-accent hover:bg-sas-accent/20'
          }`}
        >
          {anchorTrack.isGenerating ? 'Generating…' : 'Generate'}
        </button>
        <button
          data-testid={`bass-group-mute-${group.groupId}`}
          onClick={() => ctx.setGroupMute(memberEngineIds, !allMuted)}
          title="Mute all voices"
          className={`px-1.5 py-0.5 text-[10px] font-bold rounded-sm border transition-colors ${
            allMuted
              ? 'bg-red-500/20 border-red-500/40 text-red-400'
              : 'bg-sas-panel border-sas-border text-sas-muted hover:border-sas-accent'
          }`}
        >
          M
        </button>
        <button
          data-testid={`bass-group-solo-${group.groupId}`}
          onClick={() => ctx.setGroupSolo(memberEngineIds, !anySoloed)}
          title="Solo all voices"
          className={`px-1.5 py-0.5 text-[10px] font-bold rounded-sm border transition-colors ${
            anySoloed
              ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400'
              : 'bg-sas-panel border-sas-border text-sas-muted hover:border-sas-accent'
          }`}
        >
          S
        </button>
        <button
          data-testid={`bass-group-delete-${group.groupId}`}
          onClick={() => setConfirmDelete(true)}
          title="Delete the bassline (all voices)"
          className="px-1.5 py-0.5 text-[10px] rounded-sm border border-sas-border text-sas-muted hover:border-red-500/60 hover:text-red-400 transition-colors"
        >
          ✕
        </button>
      </div>
      {!ctx.collapsed && (
        <div className="p-1 space-y-1">
          {group.members.map((m) =>
            ctx.renderDefaultTrackRow(m.track, {
              // The prompt field shows the MECHANICAL partition label; the
              // bassline intent lives on the group header (anchor's prompt key).
              prompt: m.meta.label || 'bass voice',
              onPromptChange: undefined,
              // The partition is derived — no per-voice generate (the group
              // owns it). Copy IS per-voice: a DEEP copy appended to the group
              // (same notes + preset by value, fresh identity). Delete is the
              // inverse: it removes just that voice (the next Generate
              // re-partitions from scratch anyway).
              onGenerate: undefined,
              onCopy: () => {
                void copyBassVoice({ services: ctx.services, sound, group, member: m });
              },
              onDelete: () => handleVoiceDelete(m),
            }),
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete bassline?"
        message={`Removes ${group.members.length} voice ${
          group.members.length === 1 ? 'track' : 'tracks'
        } and their MIDI. Sounds you picked are lost.`}
        onConfirm={() => {
          setConfirmDelete(false);
          void ctx.deleteGroup(
            group.members.map((m) => ({ engineId: m.track.handle.id, dbId: m.dbId })),
            [BASS_VOICE_META_KEY, 'prompt', 'soundHistory', 'role', 'groupUi'],
          );
        }}
        onCancel={() => setConfirmDelete(false)}
        testIdPrefix={`bass-group-delete-confirm-${group.groupId}`}
      />
      {regenerate.dialog}
    </div>
  );
}

// ============================================================================
// The adapter
// ============================================================================

function createBassGeneratorAdapter(host: PluginHost): GeneratorPanelAdapter<BassVoiceMeta> {
  // One shared Surge sound adapter: the panel's sound serialization AND the
  // per-voice deep-copy flow use the same instance.
  const surgeSound = createSurgeSoundAdapter(host);
  return {
    identity: {
      familyKey: 'bass',
      familyLabel: 'Bass',
      trackNamePrefix: 'bass',
      logTag: 'BassGeneratorPanel',
      accentColor: '#F97316',
      transitionAccentColor: '#9333EA',
      placeholderAccentColor: '#3B82F6',
      maxTracks: BASS_MAX_TRACKS,
      estimatedGenerationMs: ESTIMATED_GENERATION_MS,
      addTrackLabel: 'Add Bassline',
      importTrackLabel: 'Import Bassline',
    },
    features: {
      instrumentPicker: true,
      bulkComposePlaceholders: false,
      exportMidi: true,
      // Fade-only designer (transitionGroup below): basslines are voice
      // GROUPS with data-dependent counts, so 1:1 crossfades are undefined —
      // each bassline verbatim-copies and fades as a unit instead.
      transitionDesigner: true,
      // Import Bassline: a bass track copied faithfully (MIDI + preset + FX)
      // from another SCENE, or a part pulled across from another panel in this
      // one — carrying its patch too when that patch is Surge state
      // (applyPortedTrackSound below). Either arrival is stamped as a bassline
      // group of ONE by onTrackCreated — the group is this panel's only shape.
      importTracks: true,
      // "Duck" cluster on the bus strip: the summed bass output dips on
      // every kick in the scene (kick-MIDI-derived — mute-proof, follows
      // regenerated kicks). Bass is the first family to ship it.
      busSidechain: true,
      // "WOB" cluster on the bus strip: tempo-locked filter motion (dubstep
      // wobble / gate) rendered per-sample in the engine — live and bounced
      // output identical. Bass is the first family to ship it.
      busMotion: true,
    },
    createTrackOptions: () => ({ loadSynth: true, synthName: 'Surge XT' }),
    applyPortedTrackSound: async (handle: PluginTrackHandle, _role, source) => {
      // A ported part arrives wearing the SOURCE panel's role ('lead',
      // 'keys'…), which would send a preset shuffle hunting in the wrong
      // category. Bass tracks are always role 'bass' — same as generation —
      // so re-role FIRST, then sound it.
      await host.setTrackRole(handle.id, 'bass').catch(() => {});
      // Inherit the source's patch when it can travel (Surge → Surge);
      // otherwise a fresh bass preset. See src/port-sound.ts.
      await applyPortedBassSound({ host, sound: surgeSound, trackId: handle.id, source });
    },
    // A bassline that ARRIVES (cross-scene import or cross-panel port) becomes
    // a voice-group of one, so it reads and behaves like every other bassline:
    // group header with the prompt + Generate, voice row underneath, and the
    // next Generate re-partitions it (reusing voice 0, so the imported preset
    // survives). Add Bassline is deliberately NOT stamped — an empty track has
    // nothing to anchor, and the first generation builds the real group.
    onTrackCreated: async (handle: PluginTrackHandle, ctx) => {
      if (ctx.origin === 'add') return;
      await stampBassAnchor(host, ctx.activeSceneId, ctx.trackDataKey, handle.dbId);
    },
    // The core passes the scene meter (SDK 2.50.0) — non-4/4 scenes append
    // the bass meter rules; 4/4 stays byte-identical. Roles are unused (bass
    // tracks are always role 'bass').
    buildSystemPrompt: (_validRoles, timeSignature) => buildBassSystemPrompt(timeSignature),
    parseNotesResponse: parseLLMNoteResponse,
    sound: surgeSound,
    shuffle: {
      // Same mechanical path as synth: role 'bass' + the clip's REAL pitch
      // range drive the Basses-hi/low category host-side. The live prompt
      // upgrades the pick to semantic retrieval when the patch index is there.
      shuffle: async (track: GeneratorTrackState, excludeNames: string[]) => {
        const result = await host.shufflePreset(track.handle.id, excludeNames, {
          description: track.prompt,
        });
        return { appliedName: result.presetName };
      },
      isExhaustedError: (err: unknown) =>
        /no presets available/i.test(err instanceof Error ? err.message : String(err)),
    },
    generation: { generate: generateBassline },
    groupExtensions: [
      {
        ...bassVoiceGroupSpec,
        isComplete: bassGroupIsComplete,
        renderGroup: (group, ctx) => <BassVoiceGroupRow group={group} ctx={ctx} sound={surgeSound} />,
      },
    ],
    transitionGroup: createBassTransitionGroupAdapter(host),
  };
}

// ============================================================================
// BassGeneratorPanel
// ============================================================================

export function BassGeneratorPanel(props: PluginUIProps): React.ReactElement {
  // Referentially stable adapter — REQUIRED (an unstable adapter re-creates
  // the core's loadTracks every render).
  const adapter = useMemo(() => createBassGeneratorAdapter(props.host), [props.host]);
  const core = useGeneratorPanelCore({ ui: props, adapter: adapter as GeneratorPanelAdapter });
  return <GeneratorPanelShell core={core} />;
}

export default BassGeneratorPanel;
