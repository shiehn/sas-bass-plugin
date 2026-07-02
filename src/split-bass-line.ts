/**
 * splitBassLine — the MECHANICAL voice analyzer (the heart of the bass panel).
 *
 * The LLM composes one monophonic line; THIS code decides how many tracks it
 * becomes and which note goes where. Never by declared intention — purely by
 * analysis of what was written (mirroring how preset range-selection works).
 *
 * MULTI-VOICE: there is NO upper bound on voice count here — most basslines
 * naturally land on 1–3 voices (especially short loops), but the analyzer
 * emits as many voices as the line's structure supports; the only hard
 * ceiling is the 16-track budget, enforced at generation time.
 *
 * Two split dimensions, register preferred:
 *
 *  1. REGISTER — cluster pitches at EVERY adjacent gap of at least
 *     SPLIT_MIN_GAP_SEMITONES (a wide line with sub, mid growl, and high
 *     stabs yields three clusters; two gaps ≥ threshold → 3 voices, and so
 *     on). Clusters holding < SPLIT_MIN_CLASS_SHARE of the notes never drop —
 *     each merges into its nearest surviving cluster. Fires when ≥ 2 clusters
 *     survive. Buckets order low → high: 'low', 'mid'…, 'high'.
 *
 *  2. METRIC — classify each note's grid position (fractional beat after the
 *     1/16 quantize: 0 = downbeat "1,2,3,4"; .5 = 8th-off "&"; .25/.75 =
 *     16th-off "e,a"). Classes holding ≥ SPLIT_MIN_CLASS_SHARE become voices;
 *     a sub-threshold class never drops notes — it merges into the largest
 *     voiced class. (Three classes is the arity of the 1/16 grid, not a cap.)
 *     An off-class bucket that absorbed the OTHER off-class's notes is
 *     labeled generic "offbeats (e,&,a)"; the downbeat bucket keeps its
 *     label even when it absorbs strays.
 *
 * Single voice when fewer than SPLIT_MIN_NOTES notes or neither dimension
 * fires. Output buckets are ordered (voiceIndex order); bucket 0 is the
 * anchor (lowest register, or downbeats, or the whole line). Every bucket is
 * non-empty by construction.
 */

import type { PluginMidiNote } from '@signalsandsorcery/plugin-sdk';

export type BassPartition =
  | 'single'
  | 'low'
  | 'mid'
  | 'high'
  | 'downbeats'
  | 'offbeats'
  | 'offbeats-8th'
  | 'offbeats-16th'
  // Variety voice (variety-voice.ts): structurally-placed notes extracted at
  // 4-bar-group boundaries when the line is repetitive over a long clip.
  | 'accents-down'
  | 'accents-end'
  | 'accents';

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

  // Cut at EVERY adjacent gap ≥ threshold — as many clusters as the line's
  // register structure supports (no upper bound).
  const pitchClusters: number[][] = [[pitches[0]]];
  for (let i = 1; i < pitches.length; i++) {
    if (pitches[i] - pitches[i - 1] >= SPLIT_MIN_GAP_SEMITONES) {
      pitchClusters.push([pitches[i]]);
    } else {
      pitchClusters[pitchClusters.length - 1].push(pitches[i]);
    }
  }
  if (pitchClusters.length < 2) return null;

  interface Cluster {
    notes: PluginMidiNote[];
    centroid: number;
  }
  let clusters: Cluster[] = pitchClusters.map((ps) => {
    const set = new Set(ps);
    const cn = notes.filter((n) => set.has(n.pitch));
    return { notes: cn, centroid: ps.reduce((s, p) => s + p, 0) / ps.length };
  });

  // Sub-threshold clusters never drop notes — each merges into its NEAREST
  // surviving cluster (by pitch centroid; ties toward the lower one).
  // Smallest-first keeps the merge order deterministic.
  const minCount = notes.length * SPLIT_MIN_CLASS_SHARE;
  for (;;) {
    if (clusters.length < 2) break;
    const small = clusters
      .filter((c) => c.notes.length < minCount)
      .sort((a, b) => a.notes.length - b.notes.length || a.centroid - b.centroid)[0];
    if (!small) break;
    const others = clusters.filter((c) => c !== small);
    let target = others[0];
    for (const o of others) {
      const d = Math.abs(o.centroid - small.centroid);
      const best = Math.abs(target.centroid - small.centroid);
      if (d < best || (d === best && o.centroid < target.centroid)) target = o;
    }
    const mergedNotes = [...target.notes, ...small.notes];
    const merged: Cluster = {
      notes: mergedNotes,
      centroid: mergedNotes.reduce((s, n) => s + n.pitch, 0) / mergedNotes.length,
    };
    clusters = others.map((c) => (c === target ? merged : c));
  }
  if (clusters.length < 2) return null;

  clusters.sort((a, b) => a.centroid - b.centroid);
  return clusters.map((c, i): BassVoiceBucket => {
    const bucketNotes = [...c.notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
    if (i === 0) return { partition: 'low', label: 'low register', notes: bucketNotes };
    if (i === clusters.length - 1) return { partition: 'high', label: 'high register', notes: bucketNotes };
    const midOrdinal = clusters.length > 3 ? ` ${i}` : '';
    return { partition: 'mid', label: `mid register${midOrdinal}`, notes: bucketNotes };
  });
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
