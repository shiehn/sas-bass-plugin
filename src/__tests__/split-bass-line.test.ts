/**
 * splitBassLine — the mechanical voice analyzer (the plugin's centerpiece).
 * Fixtures mirror the product examples: disco octave bass → register split;
 * constant 16th pump → three-way metric split (downbeats / 8th-offs /
 * 16th-offs); thin off-class merges into the other OFF voice with the generic
 * label; sparse lines stay single; register beats metric.
 */

import type { PluginMidiNote } from '@signalsandsorcery/plugin-sdk';
import {
  splitBassLine,
  SPLIT_MIN_NOTES,
  SPLIT_MIN_GAP_SEMITONES,
  SPLIT_MIN_CLASS_SHARE,
  REGISTER_OVER_METRIC,
} from '../split-bass-line';

function note(pitch: number, startBeat: number, durationBeats = 0.25, velocity = 100): PluginMidiNote {
  return { pitch, startBeat, durationBeats, velocity };
}

describe('splitBassLine — single voice cases', () => {
  it('never splits below SPLIT_MIN_NOTES', () => {
    const notes = [note(26, 0, 4), note(26, 4, 4), note(26, 8, 4)];
    const buckets = splitBassLine(notes);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].partition).toBe('single');
    expect(buckets[0].notes).toHaveLength(3);
  });

  it('stays single when there is no register spread and no metric mix', () => {
    // 8 downbeat-only notes on one pitch: metric has ONE voiced class.
    const notes = Array.from({ length: 8 }, (_, i) => note(38, i));
    const buckets = splitBassLine(notes);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].partition).toBe('single');
    expect(buckets[0].label).toBe('full line');
  });
});

describe('splitBassLine — register dimension', () => {
  it('splits a disco octave bass at the octave gap (low / high)', () => {
    // Alternating D1/D2 eighths across 2 bars — the canonical example.
    const notes: PluginMidiNote[] = [];
    for (let i = 0; i < 8; i++) {
      notes.push(note(26, i)); // D1 on the beat
      notes.push(note(38, i + 0.5)); // D2 on the &
    }
    const buckets = splitBassLine(notes);
    expect(buckets.map((b) => b.partition)).toEqual(['low', 'high']);
    expect(buckets[0].notes).toHaveLength(8);
    expect(buckets[0].notes.every((n) => n.pitch === 26)).toBe(true);
    expect(buckets[1].notes).toHaveLength(8);
    expect(buckets[1].notes.every((n) => n.pitch === 38)).toBe(true);
    expect(buckets[0].label).toBe('low register');
    expect(buckets[1].label).toBe('high register');
  });

  it('register beats metric when both fire', () => {
    // The octave fixture above ALSO has a clean downbeat/8th-off metric mix;
    // the register split must win.
    expect(REGISTER_OVER_METRIC).toBe(true);
    const notes: PluginMidiNote[] = [];
    for (let i = 0; i < 8; i++) {
      notes.push(note(26, i));
      notes.push(note(38, i + 0.5));
    }
    const partitions = splitBassLine(notes).map((b) => b.partition);
    expect(partitions).toEqual(['low', 'high']);
  });

  it('cuts at EVERY qualifying gap — a three-register line yields three voices', () => {
    // Sub, mid growl, and high stabs on downbeats only (no metric mix):
    // gaps 14 and 12 → three clusters, balanced shares.
    const notes: PluginMidiNote[] = [];
    for (let bar = 0; bar < 8; bar++) {
      notes.push(note(26, bar * 4, 1), note(40, bar * 4 + 1, 0.5), note(52, bar * 4 + 2, 0.25));
    }
    const buckets = splitBassLine(notes);
    expect(buckets.map((b) => b.partition)).toEqual(['low', 'mid', 'high']);
    expect(buckets.map((b) => b.label)).toEqual(['low register', 'mid register', 'high register']);
    expect(buckets.map((b) => b.notes.length)).toEqual([8, 8, 8]);
  });

  it('supports four+ register voices with ordinal mid labels (no upper bound)', () => {
    const notes: PluginMidiNote[] = [];
    for (let bar = 0; bar < 8; bar++) {
      for (const pitch of [26, 33, 40, 47]) notes.push(note(pitch, bar * 4 + (pitch - 26) / 7));
    }
    const buckets = splitBassLine(notes);
    expect(buckets.map((b) => b.partition)).toEqual(['low', 'mid', 'mid', 'high']);
    expect(buckets.map((b) => b.label)).toEqual([
      'low register',
      'mid register 1',
      'mid register 2',
      'high register',
    ]);
  });

  it('merges a sub-threshold cluster into its NEAREST cluster instead of dropping the split', () => {
    // 8 subs + 8 mids + ONE high accent (1/17 ≈ 6%): the lone high note joins
    // the MID cluster (nearest centroid) and the 2-voice split still fires.
    const notes: PluginMidiNote[] = [];
    for (let bar = 0; bar < 8; bar++) {
      notes.push(note(26, bar * 4, 1), note(40, bar * 4 + 1, 0.5));
    }
    notes.push(note(52, 30));
    const buckets = splitBassLine(notes);
    expect(buckets.map((b) => b.partition)).toEqual(['low', 'high']);
    expect(buckets[0].notes).toHaveLength(8);
    expect(buckets[1].notes).toHaveLength(9); // mids + the absorbed accent
    expect(buckets[1].notes.some((n) => n.pitch === 52)).toBe(true);
  });

  it('does not fire below the gap threshold', () => {
    // Largest adjacent gap = 4 semitones (< 5): chromatic-ish walking line
    // on downbeats + offs so metric fires instead.
    const notes: PluginMidiNote[] = [];
    for (let i = 0; i < 4; i++) {
      notes.push(note(36, i));
      notes.push(note(40, i + 0.5));
    }
    const buckets = splitBassLine(notes);
    expect(buckets.map((b) => b.partition)).toEqual(['downbeats', 'offbeats-8th']);
    expect(SPLIT_MIN_GAP_SEMITONES).toBe(5);
  });

  it('does not fire when one cluster is below the share threshold', () => {
    // 7 low notes + 1 high accent (12.5% < 15%): register must not strand a
    // single-note voice; with all notes on downbeats, the result is single.
    const notes = [
      ...Array.from({ length: 7 }, (_, i) => note(26, i)),
      note(45, 7),
    ];
    const buckets = splitBassLine(notes);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].partition).toBe('single');
    expect(SPLIT_MIN_CLASS_SHARE).toBeCloseTo(0.15);
  });
});

describe('splitBassLine — metric dimension', () => {
  it('three-way split for a full 16th pump: 1,2,3,4 / & / e,a', () => {
    // One bar of straight 16ths on one pitch: 4 downbeats, 4 &s, 8 e/a's.
    const notes: PluginMidiNote[] = [];
    for (let beat = 0; beat < 4; beat++) {
      for (const frac of [0, 0.25, 0.5, 0.75]) {
        notes.push(note(38, beat + frac));
      }
    }
    const buckets = splitBassLine(notes);
    expect(buckets.map((b) => b.partition)).toEqual(['downbeats', 'offbeats-8th', 'offbeats-16th']);
    expect(buckets[0].notes.map((n) => n.startBeat)).toEqual([0, 1, 2, 3]);
    expect(buckets[1].notes.map((n) => n.startBeat)).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(buckets[2].notes).toHaveLength(8);
    expect(buckets[2].notes.every((n) => n.startBeat % 0.5 === 0.25)).toBe(true);
    expect(buckets[0].label).toBe('downbeats (1,2,3,4)');
    expect(buckets[1].label).toBe('8th offbeats (&)');
    expect(buckets[2].label).toBe('16th offbeats (e,a)');
  });

  it('a thin off-class merges into the other OFF voice with the generic offbeats label', () => {
    // 4 downbeats + 4 &s + ONE stray 16th (1/9 ≈ 11% < 15%). The stray joins
    // the 8th-off voice (not the downbeat sound) and that bucket goes generic.
    const notes = [
      note(38, 0), note(38, 1), note(38, 2), note(38, 3),
      note(38, 0.5), note(38, 1.5), note(38, 2.5), note(38, 3.5),
      note(38, 2.25),
    ];
    const buckets = splitBassLine(notes);
    expect(buckets.map((b) => b.partition)).toEqual(['downbeats', 'offbeats']);
    expect(buckets[0].notes).toHaveLength(4);
    expect(buckets[1].notes).toHaveLength(5); // 4 &s + the stray e
    expect(buckets[1].label).toBe('offbeats (e,&,a)');
  });

  it('thin downbeats merge into the largest voiced class, keeping specific labels', () => {
    // 1 downbeat (1/9 ≈ 11%) + 4 &s + 4 e/a's → two off voices, the stray
    // downbeat joins the largest (tie → 8th-offs first in class order).
    const notes = [
      note(38, 0),
      note(38, 0.5), note(38, 1.5), note(38, 2.5), note(38, 3.5),
      note(38, 0.25), note(38, 1.25), note(38, 2.25), note(38, 3.25),
    ];
    const buckets = splitBassLine(notes);
    expect(buckets.map((b) => b.partition)).toEqual(['offbeats-8th', 'offbeats-16th']);
    expect(buckets[0].notes).toHaveLength(5); // 4 &s + the stray downbeat
    expect(buckets[1].notes).toHaveLength(4);
  });

  it('two-way split when only downbeats and one off class exist', () => {
    const notes = [
      note(38, 0), note(38, 1), note(38, 2), note(38, 3),
      note(38, 0.75), note(38, 1.75), note(38, 2.75),
    ];
    const buckets = splitBassLine(notes);
    expect(buckets.map((b) => b.partition)).toEqual(['downbeats', 'offbeats-16th']);
    expect(buckets[1].label).toBe('16th offbeats (e,a)');
  });
});

describe('splitBassLine — determinism', () => {
  it('is input-order independent', () => {
    const notes: PluginMidiNote[] = [];
    for (let beat = 0; beat < 4; beat++) {
      for (const frac of [0, 0.25, 0.5, 0.75]) {
        notes.push(note(38, beat + frac));
      }
    }
    const shuffled = [...notes].reverse();
    const a = splitBassLine(notes);
    const b = splitBassLine(shuffled);
    expect(b.map((x) => x.partition)).toEqual(a.map((x) => x.partition));
    expect(b.map((x) => x.notes.map((n) => n.startBeat).sort((p, q) => p - q))).toEqual(
      a.map((x) => x.notes.map((n) => n.startBeat).sort((p, q) => p - q)),
    );
  });

  it('exports the tunable thresholds', () => {
    expect(SPLIT_MIN_NOTES).toBe(4);
    expect(SPLIT_MIN_GAP_SEMITONES).toBe(5);
    expect(SPLIT_MIN_CLASS_SHARE).toBeCloseTo(0.15);
  });
});
