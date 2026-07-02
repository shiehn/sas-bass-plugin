/**
 * The system prompt's contract: teach ONE monophonic line and the bass idiom;
 * never mention voices/splitting (the analyzer's job) or sounds/presets
 * (mechanical range analysis — never intention-steered).
 */

import { buildBassSystemPrompt } from '../bass-system-prompt';

describe('buildBassSystemPrompt', () => {
  const prompt = buildBassSystemPrompt();

  it('states the one-line rule and the flat schema', () => {
    expect(prompt).toContain('THE ONE-LINE RULE');
    expect(prompt).toContain('monophonic');
    expect(prompt).toContain('No two notes may overlap');
    expect(prompt).toContain('"notes"');
    // Flat schema only — no role field (bass tracks are always role 'bass').
    expect(prompt).not.toContain('"role"');
  });

  it('teaches sparseness and the electronic-bass idiom', () => {
    expect(prompt).toContain('SPARSE');
    expect(prompt).toContain('1-3 notes per bar');
    expect(prompt).toContain('octave bounce');
    expect(prompt).toContain('sub drops');
  });

  it('never mentions voices, splitting, tracks-to-create, or sounds/presets', () => {
    const lower = prompt.toLowerCase();
    expect(lower).not.toContain('voice');
    expect(lower).not.toContain('split');
    expect(lower).not.toContain('preset');
    expect(lower).not.toContain('basses-');
    expect(lower).not.toContain('surge');
    expect(lower).not.toContain('archetype');
  });

  it('keeps the register guidance inside the fold window', () => {
    expect(prompt).toContain('26-55');
    expect(prompt).toContain('D1-G3');
  });
});
