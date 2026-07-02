/**
 * Variety voice — repetition-driven symmetric timbre variety.
 *
 * The centerpiece fixture mirrors the real track that motivated the feature
 * (project "one-six-six", scene "DnB": two short mid hits + one sustained sub
 * per bar, repeated over 16 bars): high repetition over a long clip must
 * extract phrase-boundary notes into a third voice, every 4 bars.
 */

import type { PluginMidiNote } from '@signalsandsorcery/plugin-sdk';
import {
  analyzeBassVoices,
  extractVarietyVoice,
  repetitivenessScore,
  VARIETY_MIN_BARS,
  VARIETY_MIN_REPETITION,
  VARIETY_HIGH_REPETITION,
  VARIETY_GROUP_BARS,
} from '../variety-voice';
import { splitBassLine } from '../split-bass-line';

function note(pitch: number, startBeat: number, durationBeats = 0.25, velocity = 100): PluginMidiNote {
  return { pitch, startBeat, durationBeats, velocity };
}

/** One bar of the user's real shape: two short mid hits, then a sustained sub. */
function hitsAndSubBar(barIndex: number): PluginMidiNote[] {
  const b = barIndex * 4;
  return [
    note(45, b, 0.25),        // short hit on the downbeat
    note(45, b + 0.5, 0.25),  // short hit on the &
    note(26, b + 1, 3),       // sustained sub for the rest of the bar
  ];
}

function repeatedHitsAndSub(bars: number): PluginMidiNote[] {
  const out: PluginMidiNote[] = [];
  for (let i = 0; i < bars; i++) out.push(...hitsAndSubBar(i));
  return out;
}

// ---------------------------------------------------------------------------
// repetitivenessScore
// ---------------------------------------------------------------------------

describe('repetitivenessScore', () => {
  it('scores 16 identical bars as fully repetitive', () => {
    expect(repetitivenessScore(repeatedHitsAndSub(16), 16)).toBe(1);
  });

  it('scores an ABAB alternation as highly repetitive (all bars past the pair repeat)', () => {
    const notes: PluginMidiNote[] = [];
    for (let i = 0; i < 16; i++) {
      notes.push(i % 2 === 0 ? note(26, i * 4, 2) : note(38, i * 4 + 0.5, 0.25));
    }
    expect(repetitivenessScore(notes, 16)).toBeCloseTo(14 / 15);
  });

  it('scores a through-composed line as 0', () => {
    const notes = Array.from({ length: 16 }, (_, i) => note(26 + i, i * 4 + (i % 4) * 0.25, 0.5));
    expect(repetitivenessScore(notes, 16)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The motivating fixture: 16 bars of hits + sub
// ---------------------------------------------------------------------------

describe('analyzeBassVoices — the one-six-six DnB fixture', () => {
  const notes = repeatedHitsAndSub(16);

  it('adds a phrase-accents voice on top of the register split (very high repetition → both boundaries)', () => {
    const buckets = analyzeBassVoices(notes, 16);
    expect(buckets.map((b) => b.partition)).toEqual(['low', 'high', 'accents']);
    expect(buckets[2].label).toBe(`phrase accents (every ${VARIETY_GROUP_BARS} bars)`);

    // 4 groups × (first hit + last sub) = 8 extracted notes.
    expect(buckets[2].notes).toHaveLength(8);
    // Group firsts: the downbeat hit of bars 1, 5, 9, 13.
    const starts = buckets[2].notes.map((n) => n.startBeat);
    for (const g of [0, 1, 2, 3]) {
      expect(starts).toContain(g * 16);          // group-boundary hit
      expect(starts).toContain(g * 16 + 13);     // group-final sustained sub (bar 4 of the group @ +1)
    }
  });

  it('moves notes (never duplicates): totals conserved, no note in two buckets', () => {
    const buckets = analyzeBassVoices(notes, 16);
    const total = buckets.reduce((s, b) => s + b.notes.length, 0);
    expect(total).toBe(notes.length);
    const seen = new Set<PluginMidiNote>();
    for (const b of buckets) {
      for (const n of b.notes) {
        expect(seen.has(n)).toBe(false);
        seen.add(n);
      }
    }
    // Source voices were thinned, not hollowed.
    expect(buckets[0].notes.length).toBe(16 - 4); // subs minus 4 group-finals
    expect(buckets[1].notes.length).toBe(32 - 4); // hits minus 4 group-firsts
  });
});

// ---------------------------------------------------------------------------
// Moderate repetition → single extraction, chosen by the duration cue
// ---------------------------------------------------------------------------

describe('extraction target selection (moderate repetition)', () => {
  function withUniqueTail(repetitiveBars: number, bars: number, mkBar: (i: number) => PluginMidiNote[]): PluginMidiNote[] {
    const out: PluginMidiNote[] = [];
    for (let i = 0; i < repetitiveBars; i++) out.push(...mkBar(i));
    // Unique tail bars: distinct pitches/positions so they never repeat.
    for (let i = repetitiveBars; i < bars; i++) {
      out.push(note(28 + (i % 8), i * 4, 0.25), note(43 - (i % 5), i * 4 + 1 + (i % 3) * 0.25, 0.5));
    }
    return out;
  }

  it('prefers the sustained phrase-END when last notes are long (accents-end)', () => {
    const notes = withUniqueTail(12, 16, hitsAndSubBar); // score 11/15 ≈ 0.73
    const score = repetitivenessScore(notes, 16);
    expect(score).toBeGreaterThanOrEqual(VARIETY_MIN_REPETITION);
    expect(score).toBeLessThan(VARIETY_HIGH_REPETITION);

    const buckets = analyzeBassVoices(notes, 16);
    const variety = buckets[buckets.length - 1];
    expect(variety.partition).toBe('accents-end');
    expect(variety.notes).toHaveLength(4); // one per 4-bar group
  });

  it('falls back to the downbeat hit when phrase-ends are short (accents-down)', () => {
    const shortHitsBar = (i: number): PluginMidiNote[] => [
      note(38, i * 4, 0.25),
      note(38, i * 4 + 2, 0.25),
      note(38, i * 4 + 3.5, 0.25),
    ];
    const notes = withUniqueTail(12, 16, shortHitsBar);
    const score = repetitivenessScore(notes, 16);
    expect(score).toBeGreaterThanOrEqual(VARIETY_MIN_REPETITION);
    expect(score).toBeLessThan(VARIETY_HIGH_REPETITION);

    const buckets = analyzeBassVoices(notes, 16);
    const variety = buckets[buckets.length - 1];
    expect(variety.partition).toBe('accents-down');
    expect(variety.notes.map((n) => n.startBeat)).toEqual([0, 16, 32, 48]);
  });
});

// ---------------------------------------------------------------------------
// Skip conditions
// ---------------------------------------------------------------------------

describe('variety skip conditions', () => {
  it('never fires below VARIETY_MIN_BARS', () => {
    const notes = repeatedHitsAndSub(4);
    const buckets = analyzeBassVoices(notes, 4);
    expect(buckets.map((b) => b.partition)).toEqual(['low', 'high']);
    expect(VARIETY_MIN_BARS).toBe(8);
  });

  it('never fires on a low-repetition line', () => {
    const notes = Array.from({ length: 16 }, (_, i) =>
      note(26 + (i % 12), i * 4 + (i % 4) * 0.25, i % 2 === 0 ? 0.25 : 2),
    );
    const primary = splitBassLine(notes);
    expect(extractVarietyVoice(primary, notes, 16)).toBe(primary);
  });

  it('stacks on top of a 3-voice primary split — voice count has no upper bound', () => {
    // Full 16th pump over 8 bars → 3-way metric split; fully repetitive, so
    // the variety voice appends as a FOURTH voice (both boundaries per group).
    const notes: PluginMidiNote[] = [];
    for (let beat = 0; beat < 32; beat++) {
      for (const frac of [0, 0.25, 0.5, 0.75]) notes.push(note(38, beat + frac));
    }
    const buckets = analyzeBassVoices(notes, 8);
    expect(buckets.map((b) => b.partition)).toEqual([
      'downbeats',
      'offbeats-8th',
      'offbeats-16th',
      'accents',
    ]);
    // 2 groups × (first + last) = 4 extracted notes, moved not duplicated.
    expect(buckets[3].notes.map((n) => n.startBeat)).toEqual([0, 15.75, 16, 31.75]);
    expect(buckets.reduce((s, b) => s + b.notes.length, 0)).toBe(notes.length);
  });

  it('bails rather than hollow out a primary voice', () => {
    // The low voice's ONLY notes are the group-final subs (4 of 20 notes =
    // 20% share, so the register split DOES fire) — extracting them would
    // empty it; the analyzer must return the untouched primary split.
    const notes: PluginMidiNote[] = [];
    for (let i = 0; i < 16; i++) {
      notes.push(note(45, i * 4, 0.25)); // one short mid hit per bar
      if (i % 4 === 3) notes.push(note(26, i * 4 + 3, 1)); // one sub per group, group-final
    }
    const primary = splitBassLine(notes);
    expect(primary.map((b) => b.partition)).toEqual(['low', 'high']);
    expect(repetitivenessScore(notes, 16)).toBeGreaterThanOrEqual(VARIETY_MIN_REPETITION);

    const buckets = analyzeBassVoices(notes, 16);
    expect(buckets.map((b) => b.partition)).toEqual(['low', 'high']);
    expect(buckets[0].notes).toHaveLength(4);
  });
});
