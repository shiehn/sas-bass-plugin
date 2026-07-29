/**
 * Meter-aware validation + voice-analysis regressions (P8a).
 *
 * The audit-predicted bug: `clampToClip` hardcoded `bars * 4`, so any meter
 * whose bar exceeds 4 quarter notes (5/4, 6/4, 7/4, 12/8…) had VALID
 * back-of-bar notes dropped or trimmed, while shorter meters (3/4, 6/8…)
 * accepted notes that lie past the scene's real end. These tests pin the
 * fix — and pin that the meterless call remains byte-for-byte the legacy
 * 4/4 behavior.
 */

import type { PluginMidiNote } from '@signalsandsorcery/plugin-sdk';
import { clampToClip } from '../validate-bass-line';
import {
  analyzeBassVoices,
  extractVarietyVoice,
  repetitivenessScore,
  VARIETY_GROUP_BARS,
} from '../variety-voice';
import { splitBassLine } from '../split-bass-line';

function note(pitch: number, startBeat: number, durationBeats = 0.5, velocity = 100): PluginMidiNote {
  return { pitch, startBeat, durationBeats, velocity };
}

describe('clampToClip — meter-aware clip bounds', () => {
  it('accepts a full valid 3/4 line and rejects notes past its real end (audit regression)', () => {
    // 4 bars of 3/4 = 12 qn. Beat 11.5 is the last eighth of the clip —
    // valid; beat 13 lies past the end — the legacy bars*4 clamp (16 qn)
    // wrongly ACCEPTED it.
    const out = clampToClip([note(38, 0, 1), note(38, 11.5, 0.5), note(38, 13, 1)], 4, '3/4');
    expect(out.map((n) => n.startBeat)).toEqual([0, 11.5]);
  });

  it('keeps valid back-of-bar 6/4 notes the legacy clamp dropped (audit regression)', () => {
    // 2 bars of 6/4 = 12 qn. Beats 4.5 and 10 are ordinary in-bar positions;
    // the legacy bars*4 clamp (8 qn) dropped beat 10 and trimmed tails at 8.
    const line = [note(38, 0, 1), note(38, 4.5, 0.5), note(38, 7.5, 1), note(38, 10, 2)];
    const out = clampToClip(line, 2, '6/4');
    expect(out).toHaveLength(4);
    expect(out.find((n) => n.startBeat === 10)!.durationBeats).toBe(2); // 10+2 = 12 = clip end
  });

  it('trims tails to the meter-true clip end (6/8: 4 bars = 12 qn)', () => {
    const out = clampToClip([note(38, 11, 4)], 4, '6/8');
    expect(out).toHaveLength(1);
    expect(out[0].durationBeats).toBeCloseTo(1); // trimmed to end at 12 qn
  });

  it('handles fractional bar spans (7/8: 2 bars = 7 qn)', () => {
    const out = clampToClip([note(38, 6.5, 1), note(38, 7, 1)], 2, '7/8');
    expect(out).toHaveLength(1);
    expect(out[0].startBeat).toBe(6.5);
    expect(out[0].durationBeats).toBeCloseTo(0.5);
  });

  it('meterless and 4/4 calls reproduce the legacy bars*4 behavior exactly', () => {
    const line = [note(38, 16, 1), note(38, 15.5, 2), note(38, 0, 1)];
    expect(clampToClip(line, 4)).toEqual(clampToClip(line, 4, '4/4'));
    expect(clampToClip(line, 4)).toHaveLength(2);
  });

  it('degrades malformed meters to 4/4 instead of throwing', () => {
    const line = [note(38, 0, 1), note(38, 15.5, 1)];
    expect(clampToClip(line, 4, 'waltz')).toEqual(clampToClip(line, 4, '4/4'));
  });
});

describe('variety voice — meter-aware bar/group windows', () => {
  /** A maximally repetitive line: the same bar figure in every bar. */
  function repetitiveLine(bars: number, qnPerBar: number): PluginMidiNote[] {
    const notes: PluginMidiNote[] = [];
    for (let b = 0; b < bars; b++) {
      notes.push(note(38, b * qnPerBar, 0.5));
      notes.push(note(45, b * qnPerBar + 1, 0.5));
      notes.push(note(38, b * qnPerBar + 2, 0.5));
      notes.push(note(45, b * qnPerBar + 2.5, 0.25));
    }
    return notes;
  }

  it('repetitivenessScore sees identical 3/4 bars as repetition only with the meter passed', () => {
    const line = repetitiveLine(8, 3); // 8 identical 3-qn bars
    // With the meter: every bar past the first repeats bar 0 → score 1.
    expect(repetitivenessScore(line, 8, '3/4')).toBe(1);
    // Without it, the 4-qn window slices the figure across bar boundaries —
    // the score no longer reads "fully repetitive".
    expect(repetitivenessScore(line, 8)).toBeLessThan(1);
  });

  it('extracts the variety voice at 4-BAR boundaries in the scene meter (groups stay bars)', () => {
    const bars = 8;
    const line = repetitiveLine(bars, 3); // 3/4
    const buckets = analyzeBassVoices(line, bars, '3/4');
    const variety = buckets[buckets.length - 1];
    expect(['accents', 'accents-down', 'accents-end']).toContain(variety.partition);
    expect(variety.label).toContain(`every ${VARIETY_GROUP_BARS} bars`);
    // Group boundaries are 4 bars × 3 qn = 12 qn apart: one extracted note
    // per group must sit in each 12-qn window.
    const inFirstGroup = variety.notes.filter((n) => n.startBeat < 12);
    const inSecondGroup = variety.notes.filter((n) => n.startBeat >= 12 && n.startBeat < 24);
    expect(inFirstGroup.length).toBeGreaterThan(0);
    expect(inSecondGroup.length).toBeGreaterThan(0);
  });

  it('meterless analysis is unchanged (4/4 legacy behavior)', () => {
    const line = repetitiveLine(8, 4);
    expect(analyzeBassVoices(line, 8)).toEqual(analyzeBassVoices(line, 8, '4/4'));
  });

  it('extractVarietyVoice leaves buckets untouched below the repetition gate in any meter', () => {
    // Through-composed line: every 6/8 bar differs.
    const notes: PluginMidiNote[] = [];
    for (let b = 0; b < 8; b++) notes.push(note(30 + b, b * 3, 0.5));
    const primary = splitBassLine(notes);
    expect(extractVarietyVoice(primary, notes, 8, '6/8')).toEqual(primary);
  });
});
