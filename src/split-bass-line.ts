/**
 * splitBassLine — the MECHANICAL voice analyzer (the heart of the bass panel).
 *
 * The LLM composes one monophonic line; THIS code decides how many tracks it
 * becomes and which note goes where. Never by declared intention — purely by
 * analysis of what was written (mirroring how preset range-selection works).
 *
 * Two split dimensions, register preferred:
 *
 *  1. REGISTER — cluster pitches at the largest adjacent gap. Fires when the
 *     gap is ≥ SPLIT_MIN_GAP_SEMITONES and both clusters carry
 *     ≥ SPLIT_MIN_CLASS_SHARE of the notes. (Disco octave bass: D1s vs D2s.)
 *     Always 2 voices: low / high.
 *
 *  2. METRIC — classify each note's grid position (fractional beat after the
 *     1/16 quantize: 0 = downbeat "1,2,3,4"; .5 = 8th-off "&"; .25/.75 =
 *     16th-off "e,a"). Classes holding ≥ SPLIT_MIN_CLASS_SHARE become voices
 *     (2 OR 3); a sub-threshold class never drops notes — it merges into the
 *     largest voiced class. An off-class bucket that absorbed the OTHER
 *     off-class's notes is labeled generic "offbeats (e,&,a)"; the downbeat
 *     bucket keeps its label even when it absorbs strays.
 *
 * Single voice when fewer than SPLIT_MIN_NOTES notes or neither dimension
 * fires. Output buckets are ordered (voiceIndex order); bucket 0 is the
 * anchor (low register, or downbeats, or the whole line). Every bucket is
 * non-empty by construction.
 */

import type { PluginMidiNote } from '@signalsandsorcery/plugin-sdk';

export type BassPartition =
  | 'single'
  | 'low'
  | 'high'
  | 'downbeats'
  | 'offbeats'
  | 'offbeats-8th'
  | 'offbeats-16th';

export interface BassVoiceBucket {
  partition: BassPartition;
  /** Short human label — shown as the voice track's prompt-field text. */
  label: string;
  notes: PluginMidiNote[];
}

/** Lines shorter than this never split. */
export const SPLIT_MIN_NOTES = 4;
/** Register split fires at an adjacent pitch gap of at least this many semitones. */
export const SPLIT_MIN_GAP_SEMITONES = 5;
/** A cluster/class must hold at least this share of the notes to become a voice. */
export const SPLIT_MIN_CLASS_SHARE = 0.15;
/** When both dimensions fire, register wins (tunable precedence). */
export const REGISTER_OVER_METRIC = true;

const FRAC_EPS = 1e-6;

export function splitBassLine(notes: PluginMidiNote[]): BassVoiceBucket[] {
  if (notes.length < SPLIT_MIN_NOTES) {
    return [singleBucket(notes)];
  }
  const register = registerCandidate(notes);
  const metric = metricCandidate(notes);
  if (register && metric) return REGISTER_OVER_METRIC ? register : metric;
  if (register) return register;
  if (metric) return metric;
  return [singleBucket(notes)];
}

function singleBucket(notes: PluginMidiNote[]): BassVoiceBucket {
  return { partition: 'single', label: 'full line', notes: [...notes] };
}

// ---------------------------------------------------------------------------
// Register dimension
// ---------------------------------------------------------------------------

function registerCandidate(notes: PluginMidiNote[]): BassVoiceBucket[] | null {
  const pitches = [...new Set(notes.map((n) => n.pitch))].sort((a, b) => a - b);
  if (pitches.length < 2) return null;

  let bestGap = 0;
  let boundary = pitches[0];
  for (let i = 0; i < pitches.length - 1; i++) {
    const gap = pitches[i + 1] - pitches[i];
    if (gap > bestGap) {
      bestGap = gap;
      boundary = pitches[i];
    }
  }
  if (bestGap < SPLIT_MIN_GAP_SEMITONES) return null;

  const low = notes.filter((n) => n.pitch <= boundary);
  const high = notes.filter((n) => n.pitch > boundary);
  const share = Math.min(low.length, high.length) / notes.length;
  if (share < SPLIT_MIN_CLASS_SHARE) return null;

  return [
    { partition: 'low', label: 'low register', notes: low },
    { partition: 'high', label: 'high register', notes: high },
  ];
}

// ---------------------------------------------------------------------------
// Metric dimension
// ---------------------------------------------------------------------------

type MetricClass = 'down' | 'eighth' | 'sixteenth';
const METRIC_ORDER: MetricClass[] = ['down', 'eighth', 'sixteenth'];

function metricClassOf(startBeat: number): MetricClass {
  const frac = startBeat - Math.floor(startBeat);
  if (frac < FRAC_EPS || frac > 1 - FRAC_EPS) return 'down';
  if (Math.abs(frac - 0.5) < FRAC_EPS) return 'eighth';
  return 'sixteenth'; // .25 / .75 after the 1/16 quantize (plus any stragglers)
}

function metricCandidate(notes: PluginMidiNote[]): BassVoiceBucket[] | null {
  const byClass: Record<MetricClass, PluginMidiNote[]> = { down: [], eighth: [], sixteenth: [] };
  for (const n of notes) byClass[metricClassOf(n.startBeat)].push(n);

  const voiced = METRIC_ORDER.filter(
    (c) => byClass[c].length / notes.length >= SPLIT_MIN_CLASS_SHARE,
  );
  if (voiced.length < 2) return null;

  // Merge each sub-threshold (but non-empty) class — notes never drop here.
  // A stray OFF-class merges into the other voiced OFF class when one exists
  // (stray 16th notes belong with the offbeat sound, not the downbeat sound),
  // else into the largest voiced class; stray downbeats merge into the
  // largest voiced class overall. Ties break by class order.
  const absorbedOffInto = new Set<MetricClass>(); // voiced off-classes that absorbed the OTHER off-class
  for (const c of METRIC_ORDER) {
    if (voiced.includes(c) || byClass[c].length === 0) continue;
    const preferred =
      c !== 'down' ? voiced.filter((v) => v !== 'down') : voiced;
    const pool = preferred.length > 0 ? preferred : voiced;
    let target = pool[0];
    for (const v of pool) {
      if (byClass[v].length > byClass[target].length) target = v;
    }
    byClass[target].push(...byClass[c]);
    if (c !== 'down' && target !== 'down') absorbedOffInto.add(target);
  }

  return voiced.map((c): BassVoiceBucket => {
    const bucketNotes = [...byClass[c]].sort((a, b) => a.startBeat - b.startBeat);
    if (c === 'down') {
      return { partition: 'downbeats', label: 'downbeats (1,2,3,4)', notes: bucketNotes };
    }
    if (absorbedOffInto.has(c)) {
      return { partition: 'offbeats', label: 'offbeats (e,&,a)', notes: bucketNotes };
    }
    return c === 'eighth'
      ? { partition: 'offbeats-8th', label: '8th offbeats (&)', notes: bucketNotes }
      : { partition: 'offbeats-16th', label: '16th offbeats (e,a)', notes: bucketNotes };
  });
}
