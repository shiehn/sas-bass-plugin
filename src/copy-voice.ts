/**
 * Copy one VOICE of a bassline group (not the whole group).
 *
 * DEEP COPY — no pointer to the original track, ever. This codebase has been
 * burned by shallow track copies before (scene_duplicate clones sharing the
 * source's identity), so the discipline here is structural:
 *
 *   - the copy is a brand-new track from host.createTrack (fresh engine id,
 *     fresh DB row, fresh dbId) — never an engine-level clone API
 *   - notes are read from the engine and VALUE-copied (`{...n}` per note)
 *     before the write; the new clip shares no object with the source
 *   - the preset is copied as a STATE BLOB via the snapshot path and
 *     persisted as the NEW track's own durable identity
 *     (adapter.copySnapshot → persistTrackPresetState on the new track)
 *   - the new bassVoice meta is keyed by the NEW dbId; its only cross-track
 *     field is `groupId` (the anchor's id — group membership, not a source
 *     pointer). The label gets a "(copy)" suffix; voiceIndex = max + 1, so
 *     the group header's voice count updates on the next resolve.
 *
 * The copy spawns MUTED (it doubles the source's notes verbatim — unmuting
 * both plays them in unison until the user re-sounds or edits one). LIFO
 * rollback on any failure.
 */

import type {
  GenerationServices,
  GeneratorTrackState,
  PanelSoundAdapter,
  PluginMidiNote,
  ResolvedTrackGroup,
} from '@signalsandsorcery/plugin-sdk';
import { panelClipEndSeconds } from '@signalsandsorcery/plugin-sdk';
import { BASS_VOICE_META_KEY, type BassVoiceMeta } from './bass-voice-meta';
import { BASS_MAX_TRACKS } from './bass-generation';

export interface CopyBassVoiceOptions {
  services: GenerationServices;
  sound: PanelSoundAdapter;
  group: ResolvedTrackGroup<BassVoiceMeta, GeneratorTrackState>;
  member: { dbId: string; meta: BassVoiceMeta; track: GeneratorTrackState };
}

export async function copyBassVoice({
  services,
  sound,
  group,
  member,
}: CopyBassVoiceOptions): Promise<void> {
  const { host } = services;
  const scene = services.activeSceneId;
  if (!scene) {
    host.showToast('warning', 'Select SCENE');
    return;
  }
  if (services.tracks.length >= BASS_MAX_TRACKS) {
    host.showToast('warning', 'Track limit reached');
    return;
  }
  if (typeof host.readMidiNotes !== 'function') {
    host.showToast('error', 'Copy failed', 'This host cannot read voice MIDI (update the app).');
    return;
  }

  // New voiceIndex appends to the group (gaps tolerated: max + 1).
  const nextVoiceIndex = group.members.reduce((m, x) => Math.max(m, x.meta.voiceIndex), -1) + 1;

  const handle = await host.createTrack({
    name: `bass-${Date.now()}-v${nextVoiceIndex}`,
    loadSynth: true,
    synthName: 'Surge XT',
  });
  try {
    // --- Notes: engine read → VALUE copy → write to the NEW track ---------
    const midi = await host.readMidiNotes(member.track.handle.id);
    const sourceNotes = midi.clips[0]?.notes ?? [];
    const notes: PluginMidiNote[] = sourceNotes.map((n) => ({ ...n }));
    if (notes.length > 0) {
      const mc = await host.getMusicalContext();
      await host.writeMidiClip(handle.id, {
        startTime: 0,
        endTime: panelClipEndSeconds(mc),
        tempo: mc.bpm,
        notes,
      });
    }
    await host.setTrackRole(handle.id, 'bass').catch(() => {});

    // --- Sound: same preset, copied by VALUE -------------------------------
    // Preferred: the source's durable snapshot (persisted preset identity) —
    // copySnapshot applies the state AND persists it as the NEW track's own.
    // Fallback: capture the source's LIVE instrument state and apply it
    // (covers tracks whose preset was never persisted).
    let soundCopied = false;
    if (host.getTrackSound) {
      const snap = await host.getTrackSound(member.dbId).catch(() => null);
      if (snap && snap.kind === sound.acceptedSnapshotKind) {
        await sound.copySnapshot(handle.id, snap);
        soundCopied = true;
      }
    }
    if (!soundCopied) {
      const cap = await sound.captureSoundDescriptor(member.track.handle.id).catch(() => null);
      if (cap) await sound.applySound(handle.id, cap.descriptor).catch(() => {});
    }

    // Spawn muted — same notes + same sound would double the source in unison.
    await host.setTrackMute(handle.id, true).catch(() => {});

    // --- Meta: NEW dbId key; groupId = anchor (membership, not a pointer) --
    const meta: BassVoiceMeta = {
      groupId: group.groupId,
      voiceIndex: nextVoiceIndex,
      partition: member.meta.partition,
      label: `${member.meta.label || 'bass voice'} (copy)`,
    };
    await host.setSceneData(scene, services.trackDataKey(handle.dbId, BASS_VOICE_META_KEY), meta);

    host.showToast('success', 'Voice copied', meta.label);
    await services.reloadTracks(true);
  } catch (err: unknown) {
    // LIFO rollback — the half-made copy must not survive.
    try {
      await host.deleteTrack(handle.id);
    } catch {
      /* best effort */
    }
    await host
      .deleteSceneData(scene, services.trackDataKey(handle.dbId, BASS_VOICE_META_KEY))
      .catch(() => {});
    host.showToast('error', 'Copy failed', err instanceof Error ? err.message : String(err));
  }
}
