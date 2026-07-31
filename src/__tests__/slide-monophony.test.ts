/**
 * enforceMonophony × the 303 slide flag (acid program, 2026-07-30).
 *
 * A `slide: true` note overlapping a DIFFERENT next pitch keeps its overlap —
 * on a mono/portamento Surge patch that overlap IS the glide, still one
 * sounding voice, so the ONE-LINE RULE's spirit holds. Same-pitch slides and
 * un-flagged overlaps keep the historical trim; equal-onset stacks still
 * collapse regardless of flags.
 */

import type { PluginMidiNote } from '@signalsandsorcery/plugin-sdk';
import { enforceMonophony } from '../validate-bass-line';

function note(over: Partial<PluginMidiNote> & Pick<PluginMidiNote, 'pitch' | 'startBeat'>): PluginMidiNote {
  return { durationBeats: 1, velocity: 100, ...over };
}

describe('enforceMonophony — slide exemption', () => {
  it('keeps a slide overlap onto a different pitch', () => {
    const out = enforceMonophony([
      note({ pitch: 33, startBeat: 0, durationBeats: 1.25, slide: true }),
      note({ pitch: 36, startBeat: 1, durationBeats: 0.5 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].durationBeats).toBe(1.25);
  });

  it('still trims un-flagged overlaps', () => {
    const out = enforceMonophony([
      note({ pitch: 33, startBeat: 0, durationBeats: 1.25 }),
      note({ pitch: 36, startBeat: 1, durationBeats: 0.5 }),
    ]);
    expect(out[0].durationBeats).toBe(1);
  });

  it('trims a same-pitch slide (double-trigger, not a glide)', () => {
    const out = enforceMonophony([
      note({ pitch: 33, startBeat: 0, durationBeats: 1.25, slide: true }),
      note({ pitch: 33, startBeat: 1, durationBeats: 0.5 }),
    ]);
    expect(out[0].durationBeats).toBe(1);
  });

  it('slide never protects an equal-onset stack', () => {
    const out = enforceMonophony([
      note({ pitch: 45, startBeat: 0, durationBeats: 1, slide: true }),
      note({ pitch: 33, startBeat: 0, durationBeats: 1 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].pitch).toBe(33); // lowest pitch wins the stack
  });

  it('a slide chain into a normal note survives intact', () => {
    const out = enforceMonophony([
      note({ pitch: 33, startBeat: 0, durationBeats: 0.6, slide: true }),
      note({ pitch: 36, startBeat: 0.5, durationBeats: 0.6, slide: true }),
      note({ pitch: 40, startBeat: 1, durationBeats: 0.5 }),
    ]);
    expect(out.map((n) => n.durationBeats)).toEqual([0.6, 0.6, 0.5]);
  });
});
