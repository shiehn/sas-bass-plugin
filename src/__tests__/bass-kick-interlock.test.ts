/**
 * Kick-interlock style bullets (drum-interplay follow-on, 2026-07-30).
 *
 * Two meter-independent bullets ride every bass prompt:
 *   - Kick interplay: root onsets lock to (or deliberately push against)
 *     the kick's listed onsets — REFERENCE TRACKS called out explicitly,
 *     since the groove-leader auto-pin now delivers the kick there.
 *   - Low-end space: don't start long subs dead on kick hits (frequency
 *     masking); ring between/into hits instead.
 *
 * Presence + phrasing pinned here; the 4/4 byte identity itself lives in
 * meter-prompt.test.ts. The file-header rule (no voice/track/sound language
 * in this prompt) is guarded by bass-system-prompt.test.ts.
 */
import { buildBassSystemPrompt } from '../bass-system-prompt';

const METERS: readonly (string | undefined)[] = [undefined, '4/4', '3/4', '6/8', '7/8', '12/8'];

describe('bass kick-interlock bullets — present in every meter', () => {
  it('kick interplay: lock roots to the kick onsets, REFERENCE TRACKS named', () => {
    for (const meter of METERS) {
      const prompt = buildBassSystemPrompt(meter);
      expect(prompt).toContain('Kick interplay: the kick (or 808) track\'s exact onsets are listed in the context');
      expect(prompt).toContain('especially under REFERENCE TRACKS');
      expect(prompt).toContain('Land roots ON those onsets, or place deliberate pushes just off them');
    }
  });

  it('low-end space: subs ring between kicks, never masking the transient', () => {
    for (const meter of METERS) {
      const prompt = buildBassSystemPrompt(meter);
      expect(prompt).toContain("Low-end space: the kick's transient owns its instant");
      expect(prompt).toContain('start subs between or just after kicks');
      expect(prompt).toContain('never mask each other');
    }
  });

  it('keeps (does not replace) the original genre-level kick clause', () => {
    const prompt = buildBassSystemPrompt();
    expect(prompt).toContain('lock to the kick and stay out of the snare\'s way');
  });
});
