/**
 * Meter-awareness of the bass system prompt (P8a multi-time-signature).
 *
 * BYTE-IDENTITY PIN: the snapshot below was recorded from the PRE-meter
 * implementation (`buildBassSystemPrompt()` with no meter parameter). After
 * the meter parameter landed, the 4/4 prompt — with the parameter omitted OR
 * passed explicitly as '4/4' — must still match that snapshot byte-for-byte.
 * Never update this snapshot as part of a meter change; a diff here means
 * 4/4 behavior drifted.
 */
import { buildBassSystemPrompt } from '../bass-system-prompt';

describe('buildBassSystemPrompt — 4/4 byte identity', () => {
  it('4/4 output is byte-identical to the pre-meter prompt (snapshot pin)', () => {
    expect(buildBassSystemPrompt()).toMatchSnapshot();
  });

  it("omitted, explicit '4/4', and unparseable meters all produce the identical legacy prompt", () => {
    const legacy = buildBassSystemPrompt();
    expect(buildBassSystemPrompt('4/4')).toBe(legacy);
    expect(buildBassSystemPrompt('waltz')).toBe(legacy);
    expect(buildBassSystemPrompt('')).toBe(legacy);
  });
});

describe('buildBassSystemPrompt — non-4/4 meters', () => {
  it('3/4 appends the waltz meter rules and re-grounds "strong beats"', () => {
    const prompt = buildBassSystemPrompt('3/4');
    expect(prompt).toContain('Time signature 3/4 — meter rules:');
    expect(prompt).toContain('NO beats-2-and-4 backbeat');
    expect(prompt).toContain('NOT on an imagined 4/4 grid');
    // Everything before the appended block is the untouched legacy prompt.
    expect(prompt.startsWith(buildBassSystemPrompt())).toBe(true);
  });

  it('6/8 states the compound pulses and eighth-note slot arithmetic', () => {
    const prompt = buildBassSystemPrompt('6/8');
    expect(prompt).toContain('SECOND pulse');
    expect(prompt).toContain('one slot = one eighth note = 0.5 qn');
  });

  it('7/8 states the fractional bar span and the 2+2+3 grouping', () => {
    const prompt = buildBassSystemPrompt('7/8');
    expect(prompt).toContain('spans 3.5 quarter notes');
    expect(prompt).toContain('2+2+3');
  });

  it('non-4/4 prompts still never mention voices, splitting, or sounds/presets', () => {
    for (const ts of ['3/4', '6/8', '7/8', '12/8', '5/4']) {
      const lower = buildBassSystemPrompt(ts).toLowerCase();
      expect(lower).not.toContain('voice');
      expect(lower).not.toContain('split');
      expect(lower).not.toContain('preset');
      expect(lower).not.toContain('surge');
    }
  });

  it('non-4/4 prompts keep the one-line rule and the register window', () => {
    const prompt = buildBassSystemPrompt('9/8');
    expect(prompt).toContain('THE ONE-LINE RULE');
    expect(prompt).toContain('26-55');
  });
});
