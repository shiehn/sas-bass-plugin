/**
 * Kick-interlock style bullets (drum-interplay follow-on, 2026-07-30;
 * off-the-grid fix 2026-08-10).
 *
 * Two meter-independent bullets ride every bass prompt:
 *   - Kick interplay: root onsets lock to (or deliberately push against)
 *     the kick's listed onsets — RHYTHM ANCHORS called out explicitly,
 *     since the groove-leader auto-pin delivers the kick under that header.
 *   - Low-end space: a LONG sustained sub may ring between hits to dodge
 *     frequency masking; short/mid notes still land ON the kick.
 *
 * THE REGRESSION THIS GUARDS (2026-08-10): the bullet used to read "Don't
 * start a long low sub dead ON every kick hit — start subs between or just
 * after kicks", and the auto-pinned kick arrived under a header saying
 * "avoid doubling their onsets". Together they produced basslines uniformly
 * displaced +0.5 from every kick onset — zero notes on the beat. The prompt
 * must never again tell the bass to sit off the kick grid unconditionally.
 *
 * Presence + phrasing pinned here; the 4/4 byte identity itself lives in
 * meter-prompt.test.ts. The file-header rule (no voice/track/sound language
 * in this prompt) is guarded by bass-system-prompt.test.ts.
 */
import { buildBassSystemPrompt } from '../bass-system-prompt';

const METERS: readonly (string | undefined)[] = [undefined, '4/4', '3/4', '6/8', '7/8', '12/8'];

describe('bass kick-interlock bullets — present in every meter', () => {
  it('kick interplay: lock roots to the kick onsets, RHYTHM ANCHORS named', () => {
    for (const meter of METERS) {
      const prompt = buildBassSystemPrompt(meter);
      expect(prompt).toContain('Kick interplay: the kick (or 808) track\'s exact onsets are listed in the context');
      expect(prompt).toContain('especially under RHYTHM ANCHORS');
      expect(prompt).toContain('Land roots ON those onsets, or place deliberate pushes just off them');
      expect(prompt).toContain('The MAJORITY of your notes should share an onset with the kick or fall on a beat of the bar');
    }
  });

  it('low-end space: scoped to LONG subs only, never a blanket offset', () => {
    for (const meter of METERS) {
      const prompt = buildBassSystemPrompt(meter);
      expect(prompt).toContain('Low-end space: only a LONG sustained sub (about a beat or more) can mask');
      expect(prompt).toContain('Short and mid-length notes should land ON the kick');
      expect(prompt).toContain('Never apply this as a blanket offset');
    }
  });

  it('never tells the bass to dodge the kick unconditionally (2026-08-10 regression)', () => {
    for (const meter of METERS) {
      const prompt = buildBassSystemPrompt(meter);
      // The exact phrasings that produced uniformly-displaced basslines.
      expect(prompt).not.toContain("Don't start a long low sub dead ON every kick hit");
      expect(prompt).not.toContain('start subs between or just after kicks and let them ring');
      // And the prompt must never carry counterpoint's anti-doubling wording,
      // which belongs to melodic REFERENCE tracks, not the rhythm section.
      expect(prompt).not.toContain('avoid doubling their onsets');
    }
  });

  it('keeps (does not replace) the original genre-level kick clause', () => {
    const prompt = buildBassSystemPrompt();
    expect(prompt).toContain('lock to the kick and stay out of the snare\'s way');
  });
});
