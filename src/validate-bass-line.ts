/**
 * Deterministic validation pipeline for the LLM's bassline (pure functions).
 *
 * Order matters (see the plan): parse → clip bounds → [host quantize 1/16,
 * removeOverlaps:false — the ONLY host step, done by the caller] → monophony
 * sweep → register fold → split. Quantize MUST precede the monophony sweep
 * (grid snap could re-collide notes) and the sweep MUST precede the register
 * fold (folding changes pitches, never timing, so it is time-safe afterwards).
 */

import type { PluginMidiNote } from '@signalsandsorcery/plugin-sdk';
import { barsToQn, parseLLMNoteResponse, tryParseTimeSignature } from '@signalsandsorcery/plugin-sdk';

/** Global bass register window, inclusive: D1..G3. */
export const BASS_REGISTER_LOW = 26;
export const BASS_REGISTER_HIGH = 55;
/** Matches the host MidiProcessor's removeOverlaps floor (1/64 note). */
export const MIN_NOTE_QN = 0.0625;
export const TIME_EPS = 1e-6;

/**
 * Parse the flat `{notes:[...]}` response (markdown fences tolerated,
 * per-note numeric validation identical to the synth path). Any stray `role`
 * field is ignored — bass tracks are always role 'bass'.
 */
export function parseBassLine(content: string): PluginMidiNote[] | null {
  const parsed = parseLLMNoteResponse(content);
  if (!parsed || parsed.notes.length === 0) return null;
  return parsed.notes;
}

/**
 * Drop notes starting at/past the clip end; trim tails to the clip end.
 *
 * `timeSignature` (P8a) sizes the clip in the scene meter's quarter notes —
 * omitted = '4/4', reproducing the legacy `bars * 4` exactly. Without it a
 * 6/4 line's back-of-bar notes (beats 4-6 of every bar) were wrongly
 * dropped, and a 3/4 clip accepted notes up to a bar past its real end.
 */
export function clampToClip(
  notes: PluginMidiNote[],
  bars: number,
  timeSignature: string = '4/4',
): PluginMidiNote[] {
  // Malformed meters degrade to 4/4 (today's behavior) instead of throwing
  // mid-generation — same gate panel-core's panelMeter applies.
  const meter = tryParseTimeSignature(timeSignature) ? timeSignature : '4/4';
  const totalBeats = barsToQn(bars, meter);
  const out: PluginMidiNote[] = [];
  for (const n of notes) {
    if (n.startBeat >= totalBeats - TIME_EPS) continue;
    const durationBeats = Math.min(n.durationBeats, totalBeats - n.startBeat);
    out.push({ ...n, durationBeats });
  }
  return out;
}

/**
 * THE ONE-LINE RULE, enforced: globally monophonic.
 *
 * - Stable sort by (startBeat, pitch).
 * - Equal onsets (< TIME_EPS apart): keep exactly ONE — the LOWEST pitch
 *   (bass = the fundament); drop the rest. Dropping (not trimming) is right
 *   for vertical stacks: a chord violates the contract structurally, and
 *   trimming would leave 1/64th blips.
 * - Sequential overlap: TRIM the earlier note to the next onset (mirrors the
 *   host's trim-don't-drop policy); if the trimmed duration falls below
 *   MIN_NOTE_QN, drop the earlier note instead.
 * - Butt joins (end === next start) are legato and untouched.
 *
 * Deterministic and input-order independent.
 */
export function enforceMonophony(notes: PluginMidiNote[]): PluginMidiNote[] {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);

  // Pass 1: collapse simultaneous onsets to the lowest pitch.
  const mono: PluginMidiNote[] = [];
  for (const n of sorted) {
    const prev = mono[mono.length - 1];
    if (prev && Math.abs(n.startBeat - prev.startBeat) < TIME_EPS) {
      continue; // prev has the lower pitch (sort order) — drop this one
    }
    mono.push({ ...n });
  }

  // Pass 2: trim sequential overlaps to the next onset.
  const out: PluginMidiNote[] = [];
  for (let i = 0; i < mono.length; i++) {
    const n = mono[i];
    const next = mono[i + 1];
    if (next && n.startBeat + n.durationBeats > next.startBeat + TIME_EPS) {
      const trimmed = next.startBeat - n.startBeat;
      if (trimmed < MIN_NOTE_QN) continue; // too small to keep — drop
      out.push({ ...n, durationBeats: trimmed });
    } else {
      out.push(n);
    }
  }
  return out;
}

/**
 * Octave-fold every pitch into [BASS_REGISTER_LOW, BASS_REGISTER_HIGH].
 * Folding preserves the pitch class (chord-tone anchoring survives) and never
 * touches timing (monophony already settled). The window is wider than an
 * octave, so folding always terminates inside it.
 */
export function foldToRegister(notes: PluginMidiNote[]): PluginMidiNote[] {
  return notes.map((n) => {
    let pitch = n.pitch;
    while (pitch < BASS_REGISTER_LOW) pitch += 12;
    while (pitch > BASS_REGISTER_HIGH) pitch -= 12;
    // Defensive clamp — unreachable while the window spans ≥ an octave.
    if (pitch < BASS_REGISTER_LOW) pitch = BASS_REGISTER_LOW;
    return pitch === n.pitch ? n : { ...n, pitch };
  });
}
