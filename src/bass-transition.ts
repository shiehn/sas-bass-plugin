/**
 * Bass transition-group adapter — verbatim GROUP fades for basslines.
 *
 * A bassline is a voice GROUP of 1..N tracks whose count is data-dependent
 * (register/metric analysis of one monophonic line — split-bass-line.ts), so
 * the synth-style 1:1 MIDI crossfade is undefined between two basslines.
 * Registering this adapter flips the bass panel's Transition Designer to the
 * SDK's FADE-ONLY board: one cell per BASSLINE (anchor-addressed), and Create
 * copies every voice VERBATIM (exact MIDI clamped to the transition span +
 * exact preset + FX chain — NO LLM) into the transition scene, fading the
 * whole group under one slider.
 *
 * Fade midpoints are STAGGERED by default (out→0.35, in→0.65) so the outgoing
 * and incoming basslines hand over DJ-style instead of overlapping in the
 * low end.
 */

import type {
  PluginHost,
  PanelTransitionGroupAdapter,
  SceneFamilyTrack,
  VerbatimFadeMember,
} from '@signalsandsorcery/plugin-sdk';
import { parseTrackGroups } from '@signalsandsorcery/plugin-sdk';
import { BASS_VOICE_META_KEY, bassVoiceGroupSpec, type BassVoiceMeta } from './bass-voice-meta';

/** Header/cell label for a bassline subject or group-fade row. */
export function bassGroupLabel(memberCount: number): string {
  return `Bassline (${memberCount} ${memberCount === 1 ? 'voice' : 'voices'})`;
}

async function readSceneGroups(
  host: PluginHost,
  sceneId: string,
): Promise<Array<{ groupId: string; members: Array<{ dbId: string; meta: BassVoiceMeta }> }>> {
  const sceneData = (await host.getAllSceneData(sceneId)) as Record<string, unknown>;
  return parseTrackGroups(sceneData, bassVoiceGroupSpec);
}

export function createBassTransitionGroupAdapter(host: PluginHost): PanelTransitionGroupAdapter {
  return {
    fadeOnly: true,

    // One designer cell per bassline: the subject carries the ANCHOR's dbId
    // (exclude/row keys stay member-source-exact) and the anchor's prompt as
    // its primary label. Loose bass tracks (no group meta) pass through.
    async mapColumnSubjects(
      sceneId: string,
      tracks: SceneFamilyTrack[],
    ): Promise<SceneFamilyTrack[]> {
      const groups = await readSceneGroups(host, sceneId);
      const byDbId = new Map(tracks.map((t) => [t.dbId, t]));
      const memberDbIds = new Set<string>();
      const subjects: SceneFamilyTrack[] = [];

      for (const group of groups) {
        const liveMembers = group.members.filter((m) => byDbId.has(m.dbId));
        if (liveMembers.length === 0) continue;
        const anchor =
          liveMembers.find((m) => m.meta.voiceIndex === 0) ?? liveMembers[0];
        const anchorTrack = byDbId.get(anchor.dbId);
        for (const m of liveMembers) memberDbIds.add(m.dbId);
        subjects.push({
          dbId: anchor.dbId,
          name: bassGroupLabel(liveMembers.length),
          role: anchorTrack?.role ?? 'bass',
          prompt: anchorTrack?.prompt,
        });
      }

      const loose = tracks.filter((t) => !memberDbIds.has(t.dbId));
      return [...subjects, ...loose];
    },

    // Anchor dbId → ordered members. A loose track expands to itself.
    async expandSubject(sceneId: string, subjectDbId: string): Promise<VerbatimFadeMember[]> {
      const [groups, familyTracks] = await Promise.all([
        readSceneGroups(host, sceneId),
        host.listSceneFamilyTracks ? host.listSceneFamilyTracks(sceneId) : Promise.resolve([]),
      ]);
      const nameById = new Map(familyTracks.map((t) => [t.dbId, t]));
      const group = groups.find((g) => g.groupId === subjectDbId);

      if (!group) {
        const track = nameById.get(subjectDbId);
        if (!track) return [];
        return [
          {
            dbId: track.dbId,
            name: track.name,
            role: track.role ?? 'bass',
            memberIndex: 0,
          },
        ];
      }

      return group.members
        .filter((m) => nameById.has(m.dbId))
        .sort((a, b) => a.meta.voiceIndex - b.meta.voiceIndex)
        .map((m) => {
          const track = nameById.get(m.dbId);
          return {
            dbId: m.dbId,
            name: track?.name ?? m.dbId,
            role: track?.role ?? 'bass',
            memberIndex: m.meta.voiceIndex,
            memberLabel: m.meta.label || undefined,
            familyMeta: m.meta,
          };
        });
    },

    // Give the COPIES their own bassVoice metas (groupId = the new anchor's
    // dbId) so the Tracks view renders them as a proper bassline group if the
    // fade metas are ever removed.
    async writeGroupMetas(
      transitionSceneId: string,
      copies: Array<{ newDbId: string; member: VerbatimFadeMember }>,
      newAnchorDbId: string,
    ): Promise<void> {
      for (const { newDbId, member } of copies) {
        const src = member.familyMeta as BassVoiceMeta | undefined;
        const meta: BassVoiceMeta = {
          groupId: newAnchorDbId,
          voiceIndex: member.memberIndex,
          partition: src?.partition ?? 'single',
          label: src?.label ?? member.memberLabel ?? '',
        };
        await host.setSceneData(transitionSceneId, `track:${newDbId}:${BASS_VOICE_META_KEY}`, meta);
      }
    },

    cleanupKeySuffixes: [BASS_VOICE_META_KEY],
    // Staggered handover: outgoing bassline is mostly gone before the
    // incoming one is mostly in — two full basses never stack in the middle.
    defaultSliderPos: (direction) => (direction === 'out' ? 0.35 : 0.65),
    // No LLM in a verbatim fade — pace the bar for engine copy work only.
    fadeEstimateMs: 4000,
    groupRowLabel: bassGroupLabel,
  };
}
