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
 *     mechanical partition label; no per-voice Generate/delete (the
 *     partition is derived — regenerate the group instead); full
 *     🎲 / sound-history / Pick / FX / piano-roll / mixer per voice
 *   - per-voice COPY (⧉) deep-copies a voice — same notes + preset by
 *     value, brand-new identity — appended to the group (no voice cap)
 *   - reused voices keep their preset on regeneration, ALWAYS
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
} from '@signalsandsorcery/plugin-sdk';
import { buildBassSystemPrompt } from './src/bass-system-prompt';
import { generateBassline, BASS_MAX_TRACKS } from './src/bass-generation';
import { copyBassVoice } from './src/copy-voice';
import {
  BASS_VOICE_META_KEY,
  bassVoiceGroupSpec,
  bassGroupIsComplete,
  type BassVoiceMeta,
} from './src/bass-voice-meta';
import { createBassTransitionGroupAdapter } from './src/bass-transition';
import { parseLLMNoteResponse } from '@signalsandsorcery/plugin-sdk';

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

  return (
    <div
      data-testid={`bass-group-${group.groupId}`}
      className="rounded-sm border border-sas-border bg-sas-panel-alt overflow-hidden"
      style={{ borderLeftColor: '#F97316', borderLeftWidth: '3px' }}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-sas-border">
        <span className="text-[9px] uppercase tracking-wide text-sas-muted whitespace-nowrap">
          Bassline · {group.members.length} {group.members.length === 1 ? 'voice' : 'voices'}
        </span>
        <input
          data-testid={`bass-group-prompt-${group.groupId}`}
          className="flex-1 min-w-0 bg-sas-panel border border-sas-border rounded-sm px-2 py-0.5 text-xs text-sas-text placeholder:text-sas-muted/50 focus:border-sas-accent focus:outline-none"
          value={anchorTrack.prompt}
          placeholder="Describe the bassline…"
          onChange={(e) => ctx.handlers.promptChange(anchorTrack.handle.id, e.target.value)}
        />
        <button
          data-testid={`bass-group-generate-${group.groupId}`}
          disabled={generateDisabled}
          onClick={() => ctx.handlers.generate(anchorTrack.handle.id)}
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
      <div className="p-1 space-y-1">
        {group.members.map((m) =>
          ctx.renderDefaultTrackRow(m.track, {
            // The prompt field shows the MECHANICAL partition label; the
            // bassline intent lives on the group header (anchor's prompt key).
            prompt: m.meta.label || 'bass voice',
            onPromptChange: undefined,
            // The partition is derived — no per-voice generate/delete (the
            // group owns those). Copy IS per-voice: a DEEP copy appended to
            // the group (same notes + preset by value, fresh identity).
            onGenerate: undefined,
            onCopy: () => {
              void copyBassVoice({ services: ctx.services, sound, group, member: m });
            },
            onDelete: undefined,
          }),
        )}
      </div>
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
            [BASS_VOICE_META_KEY, 'prompt', 'soundHistory', 'role'],
          );
        }}
        onCancel={() => setConfirmDelete(false)}
        testIdPrefix={`bass-group-delete-confirm-${group.groupId}`}
      />
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
    },
    features: {
      instrumentPicker: true,
      bulkComposePlaceholders: false,
      exportMidi: true,
      // Fade-only designer (transitionGroup below): basslines are voice
      // GROUPS with data-dependent counts, so 1:1 crossfades are undefined —
      // each bassline verbatim-copies and fades as a unit instead.
      transitionDesigner: true,
      importTracks: false,
    },
    createTrackOptions: () => ({ loadSynth: true, synthName: 'Surge XT' }),
    applyPortedTrackSound: async (handle: PluginTrackHandle) => {
      try {
        await host.shufflePreset(handle.id);
      } catch {
        /* non-fatal */
      }
    },
    buildSystemPrompt: () => buildBassSystemPrompt(),
    parseNotesResponse: parseLLMNoteResponse,
    sound: surgeSound,
    shuffle: {
      // Same mechanical path as synth: role 'bass' + the clip's REAL pitch
      // range drive the Basses-hi/low category host-side; random within it.
      shuffle: async (track: GeneratorTrackState, excludeNames: string[]) => {
        const result = await host.shufflePreset(track.handle.id, excludeNames);
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
