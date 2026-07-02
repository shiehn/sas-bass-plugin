/**
 * Deterministic validation pipeline: parse, clip bounds, THE ONE-LINE RULE
 * (global monophony), and the register fold.
 */

import type { PluginMidiNote } from '@signalsandsorcery/plugin-sdk';
import {
  parseBassLine,
  clampToClip,
  enforceMonophony,
  foldToRegister,
  BASS_REGISTER_LOW,
  BASS_REGISTER_HIGH,
  MIN_NOTE_QN,
} from '../validate-bass-line';

function note(pitch: number, startBeat: number, durationBeats = 0.5, velocity = 100): PluginMidiNote {
  return { pitch, startBeat, durationBeats, velocity };
}

describe('parseBassLine', () => {
  it('parses a bare JSON object and ignores a stray role field', () => {
    const notes = parseBassLine(
      JSON.stringify({ notes: [note(38, 0)], role: 'lead' }),
    );
    expect(notes).toHaveLength(1);
    expect(notes![0].pitch).toBe(38);
  });

  it('parses fenced JSON', () => {
    const content = '```json\n' + JSON.stringify({ notes: [note(38, 0)] }) + '\n```';
    expect(parseBassLine(content)).toHaveLength(1);
  });

  it('filters invalid notes and nulls on nothing valid', () => {
    const mixed = JSON.stringify({
      notes: [note(38, 0), { pitch: 200, startBeat: 0, durationBeats: 1, velocity: 100 }, { pitch: 38 }],
    });
    expect(parseBassLine(mixed)).toHaveLength(1);
    expect(parseBassLine(JSON.stringify({ notes: [] }))).toBeNull();
    expect(parseBassLine('not json')).toBeNull();
  });
});

describe('clampToClip', () => {
  it('drops past-end starts and trims tails', () => {
    const out = clampToClip([note(38, 16, 1), note(38, 15.5, 2), note(38, 0, 1)], 4);
    expect(out).toHaveLength(2);
    expect(out.find((n) => n.startBeat === 15.5)!.durationBeats).toBeCloseTo(0.5);
    expect(out.find((n) => n.startBeat === 0)!.durationBeats).toBe(1);
  });
});

describe('enforceMonophony — THE ONE-LINE RULE', () => {
  it('collapses simultaneous onsets to the lowest pitch (bass = fundament)', () => {
    const out = enforceMonophony([note(45, 0), note(38, 0), note(50, 0), note(40, 2)]);
    expect(out).toHaveLength(2);
    expect(out[0].pitch).toBe(38);
    expect(out[1].pitch).toBe(40);
  });

  it('trims a sequential overlap to the next onset', () => {
    const out = enforceMonophony([note(38, 0, 2), note(40, 1, 1)]);
    expect(out).toHaveLength(2);
    expect(out[0].durationBeats).toBeCloseTo(1);
    expect(out[1].durationBeats).toBe(1);
  });

  it('drops a note whose trim falls below the 1/64 floor', () => {
    const out = enforceMonophony([note(38, 0, 2), note(40, 0.03, 1)]);
    expect(out).toHaveLength(1);
    expect(out[0].pitch).toBe(40);
    expect(MIN_NOTE_QN).toBeCloseTo(0.0625);
  });

  it('leaves butt joins (legato) untouched', () => {
    const out = enforceMonophony([note(38, 0, 1), note(40, 1, 1)]);
    expect(out[0].durationBeats).toBe(1);
    expect(out[1].durationBeats).toBe(1);
  });

  it('is input-order independent', () => {
    const a = enforceMonophony([note(38, 0, 2), note(40, 1, 1), note(36, 3, 0.5)]);
    const b = enforceMonophony([note(36, 3, 0.5), note(40, 1, 1), note(38, 0, 2)]);
    expect(b).toEqual(a);
  });

  it('guarantees global monophony on arbitrary input', () => {
    const messy = [
      note(38, 0, 4), note(45, 0.5, 4), note(26, 0.5, 1), note(50, 2, 0.25),
      note(40, 2, 3), note(38, 3.9, 2),
    ];
    const out = enforceMonophony(messy);
    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i].startBeat + out[i].durationBeats).toBeLessThanOrEqual(out[i + 1].startBeat + 1e-6);
    }
  });
});

describe('foldToRegister', () => {
  it('octave-folds into the D1–G3 window preserving pitch class', () => {
    const out = foldToRegister([note(14, 0), note(62, 1), note(26, 2), note(55, 3)]);
    expect(out.map((n) => n.pitch)).toEqual([26, 50, 26, 55]);
    expect(out[0].pitch % 12).toBe(14 % 12);
    expect(out[1].pitch % 12).toBe(62 % 12);
    expect(out.every((n) => n.pitch >= BASS_REGISTER_LOW && n.pitch <= BASS_REGISTER_HIGH)).toBe(true);
  });

  it('never touches timing', () => {
    const src = [note(70, 1.25, 0.75)];
    const out = foldToRegister(src);
    expect(out[0].startBeat).toBe(1.25);
    expect(out[0].durationBeats).toBe(0.75);
  });
});
