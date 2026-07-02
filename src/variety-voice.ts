/**
 * Variety voice — the repetition-driven third split dimension.
 *
 * Observation (from real DnB use): the register/metric split phrases a line
 * well, but over a LONG clip (8/16 bars) a highly repetitive bassline wants
 * symmetric TIMBRE variety across its repetitions — e.g. the downbeat hit or
 * the phrase-ending sub wearing a different sound every 4 bars.
 *
 * The heuristic, mechanical like everything else in this plugin:
 * **variety pressure = repetitiveness × length.**
 *
 *  1. Repetitiveness is measured on bar fingerprints that combine RHYTHM
 *     (1/16-quantized onsets + duration buckets) and HARMONY (pitches):
 *     score = fraction of bars that exactly repeat an EARLIER bar.
 *  2. When the clip has ≥ VARIETY_MIN_BARS bars and the score ≥
 *     VARIETY_MIN_REPETITION, extract one note per VARIETY_GROUP_BARS-bar
 *     group into a new "variety" voice appended after the primary voices
 *     (however many there are — voice count has no upper bound; the 16-track
 *     budget at generation time is the only ceiling):
 *       - each group's LAST note when the last notes are sustained
 *         (mean duration ≥ VARIETY_SUSTAIN_MIN_BEATS) — "the last sub is
 *         different every 4 bars";
 *       - otherwise each group's FIRST note — "the downbeat hit gets its own
 *         track every 4 bars".
 *  3. At VARIETY_HIGH_REPETITION or above (essentially identical bars),
 *     extract BOTH boundary notes per group — more repetition, more variety.
 *
 * The extracted notes MOVE tracks (never duplicate), so global monophony is
 * untouched; the variety track's preset is later chosen mechanically from its
 * real note range with the sibling sounds excluded — a genuinely different
 * timbre recurring symmetrically at every phrase boundary.
 */

import type { PluginMidiNote } from '@signalsandsorcery/plugin-sdk';
import { splitBassLine, type BassVoiceBucket } from './split-bass-line';

/** Variety never fires on clips shorter than this many bars. */
export const VARIETY_MIN_BARS = 8;
/** Phrase-group size in bars (the "every 4 bars" symmetry). */
export const VARIETY_GROUP_BARS = 4;
/** Repetitiveness gate: below this, the line already varies — no extraction. */
export const VARIETY_MIN_REPETITION = 0.5;
/** At/above this, extract BOTH boundary notes per group. */
export const VARIETY_HIGH_REPETITION = 0.85;
/** Mean last-note duration (beats) that makes the phrase-END the extraction target. */
export const VARIETY_SUSTAIN_MIN_BEATS = 1;

const BEATS_PER_BAR = 4;

// ---------------------------------------------------------------------------
// Repetitiveness
// ---------------------------------------------------------------------------

function durationBucket(durationBeats: number): 's' | 'm' | 'l' {
  if (durationBeats < 0.5) return 's';
  if (durationBeats < 2) return 'm';
  return 'l';
}

/**
 * Fingerprint one bar: 1/16-quantized onset within the bar + pitch + duration
 * bucket per note, order-normalized. Combines the rhythmic and harmonic
 * dimensions — two bars match only when both repeat.
 */
function barFingerprint(notes: PluginMidiNote[], barIndex: number): string {
  const start = barIndex * BEATS_PER_BAR;
  const end = start + BEATS_PER_BAR;
  const cells = notes
    .filter((n) => n.startBeat >= start && n.startBeat < end)
    .map((n) => `${Math.round((n.startBeat - start) * 4) / 4}:${n.pitch}:${durationBucket(n.durationBeats)}`)
    .sort();
  return cells.join('|');
}

/**
 * Fraction of bars (past the first) that exactly repeat an EARLIER bar.
 * 16 identical bars → 15/16 ≈ 0.94; fully through-composed → 0.
 */
export function repetitivenessScore(notes: PluginMidiNote[], bars: number): number {
  if (bars <= 1) return 0;
  const seen = new Set<string>();
  let repeats = 0;
  for (let bar = 0; bar < bars; bar++) {
    const fp = barFingerprint(notes, bar);
    if (seen.has(fp)) repeats++;
    else seen.add(fp);
  }
  // Bar 0 can never be a repeat, so repeats ∈ [0, bars-1].
  return repeats / (bars - 1);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface GroupBoundaryNotes {
  first: PluginMidiNote | null;
  last: PluginMidiNote | null;
}

function boundaryNotesPerGroup(notes: PluginMidiNote[], bars: number): GroupBoundaryNotes[] {
  const groups: GroupBoundaryNotes[] = [];
  const groupCount = Math.floor(bars / VARIETY_GROUP_BARS);
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);
  for (let g = 0; g < groupCount; g++) {
    const start = g * VARIETY_GROUP_BARS * BEATS_PER_BAR;
    const end = start + VARIETY_GROUP_BARS * BEATS_PER_BAR;
    const inGroup = sorted.filter((n) => n.startBeat >= start && n.startBeat < end);
    groups.push({
      first: inGroup[0] ?? null,
      last: inGroup.length > 0 ? inGroup[inGroup.length - 1] : null,
    });
  }
  return groups;
}

/**
 * The full bass voice analysis: primary register/metric split, then the
 * repetition-driven variety extraction. This is what generation calls.
 */
export function analyzeBassVoices(notes: PluginMidiNote[], bars: number): BassVoiceBucket[] {
  const buckets = splitBassLine(notes);
  return extractVarietyVoice(buckets, notes, bars);
}

/**
 * Pure second pass over the primary split. Returns the buckets unchanged when
 * variety doesn't apply; otherwise appends ONE variety bucket (highest
 * voiceIndex — the anchor never moves) holding the extracted boundary notes,
 * which are REMOVED from their source buckets.
 */
export function extractVarietyVoice(
  buckets: BassVoiceBucket[],
  notes: PluginMidiNote[],
  bars: number,
): BassVoiceBucket[] {
  if (bars < VARIETY_MIN_BARS) return buckets;
  const groupCount = Math.floor(bars / VARIETY_GROUP_BARS);
  if (groupCount < 2) return buckets;

  const score = repetitivenessScore(notes, bars);
  if (score < VARIETY_MIN_REPETITION) return buckets;

  const groups = boundaryNotesPerGroup(notes, bars);
  const lastNotes = groups.map((g) => g.last).filter((n): n is PluginMidiNote => n !== null);
  const firstNotes = groups.map((g) => g.first).filter((n): n is PluginMidiNote => n !== null);
  if (lastNotes.length === 0 && firstNotes.length === 0) return buckets;

  // Duration cue: sustained phrase-ends make the END the target; else the
  // downbeat hit. At very high repetition, take both.
  const meanLastDuration =
    lastNotes.length > 0
      ? lastNotes.reduce((s, n) => s + n.durationBeats, 0) / lastNotes.length
      : 0;
  const preferEnd = meanLastDuration >= VARIETY_SUSTAIN_MIN_BEATS;

  let extracted: PluginMidiNote[];
  let partition: BassVoiceBucket['partition'];
  let label: string;
  if (score >= VARIETY_HIGH_REPETITION) {
    const set = new Set<PluginMidiNote>([...firstNotes, ...lastNotes]);
    extracted = [...set];
    partition = 'accents';
    label = `phrase accents (every ${VARIETY_GROUP_BARS} bars)`;
  } else if (preferEnd) {
    extracted = lastNotes;
    partition = 'accents-end';
    label = `phrase-end accents (every ${VARIETY_GROUP_BARS} bars)`;
  } else {
    extracted = firstNotes;
    partition = 'accents-down';
    label = `downbeat accents (every ${VARIETY_GROUP_BARS} bars)`;
  }

  // MOVE the notes: remove from source buckets by object identity (the
  // buckets hold the same note references the analyzer was given).
  const extractedSet = new Set(extracted);
  const thinned = buckets.map((b) => ({
    ...b,
    notes: b.notes.filter((n) => !extractedSet.has(n)),
  }));

  // Never let extraction hollow out a primary voice entirely — a voice that
  // lost ALL its notes to the variety track means the split was degenerate;
  // bail to the untouched primary split instead.
  if (thinned.some((b) => b.notes.length === 0)) return buckets;

  const varietyNotes = [...extractedSet].sort((a, b) => a.startBeat - b.startBeat);
  return [...thinned, { partition, label, notes: varietyNotes }];
}
