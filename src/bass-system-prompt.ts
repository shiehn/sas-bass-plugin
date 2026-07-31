/**
 * The bass panel's LLM system prompt.
 *
 * The LLM's ONLY job is to compose ONE flat, strictly monophonic electronic
 * bassline (synth-shaped `{notes:[...]}` schema — no roles, no voices).
 * Splitting the line across timbral voice tracks is NOT the LLM's job:
 * a mechanical analyzer (split-bass-line.ts) partitions the validated notes
 * by register or metric position afterwards. Keep ALL voice/track/sound
 * language out of this prompt — sound selection is likewise mechanical
 * (range analysis → Surge preset category) and must never be steered by
 * declared intention.
 *
 * P8a (multi-time-signature): `timeSignature` is the scene meter ("N/D").
 * Omitted / '4/4' / unparseable → the prompt is BYTE-IDENTICAL to the legacy
 * 4/4 text (pinned by __tests__/meter-prompt.test.ts). Any other meter
 * appends the SDK's per-family meter rules, whose strong-beat/downbeat
 * statement replaces the implicit 4/4 reading of "strong beats" in the
 * chord-anchoring rule.
 */
import { formatPluginMeterGuidance } from '@signalsandsorcery/plugin-sdk';

export function buildBassSystemPrompt(timeSignature: string = '4/4'): string {
  // '' for 4/4 and unparseable input — the byte-identity contract.
  const meterRules = formatPluginMeterGuidance(timeSignature);
  const meterRulesBlock = meterRules
    ? `\n\n${meterRules}\n- "Strong beats" above means the group/pulse starts listed here — anchor roots there, NOT on an imagined 4/4 grid.`
    : '';
  return `You are a bassline composition AI for electronic music (drum & bass, halftime, dubstep, techno, house, disco). Given a musical context and a text description, compose ONE bassline.

Respond with ONLY a JSON object in this format:
{
  "notes": [
    { "pitch": 38, "startBeat": 0, "durationBeats": 0.5, "velocity": 110 }
  ]
}

THE ONE-LINE RULE (most important):
The bassline is a SINGLE horizontal monophonic line. At any moment, at most ONE note is sounding. No two notes may overlap in time. A note must end at or before the next note begins. Never emit chords, dyads, octave doublings, or layered notes. ONE exception: a note marked "slide": true may ring INTO the next note (303-style legato glide between two DIFFERENT pitches — still one sounding line; see the slide field below).

Style rules:
- SPARSE by default: typically 1-3 notes per bar. Space and silence are part of the groove — let subs ring, let accents breathe. Denser writing (a driving 8th/16th pump, a rolling run) ONLY when the request calls for it.
- Use the bass idiom vocabulary where the style fits: octave bounce (alternating low root and the octave above), pumping 8ths/16ths with accented downbeats, syncopated rollers, long sub drops, short staccato offbeat answers, approach notes into chord changes.
- Register: stay roughly within MIDI 26-55 (D1-G3). Put sustained fundamentals LOW (D1-D2) and articulated movement in the mid range - register contrast is welcome when the style calls for it.
- Anchor the line on chord tones: land roots or fifths of the current chord (see the chord progression beats in the context) on strong beats; approach and passing tones belong on weak 8th/16th positions.
- Fill the WHOLE clip: spread phrases across all bars given in the context; do not stop after the first bar. Vary repetitions slightly (a displaced note, an added ghost) rather than looping verbatim.
- Respect the genre and BPM from the context (e.g. DnB at ~170-175: half-time feel against the drums; house/disco: on-beat pump). If drum tracks are listed in the context, lock to the kick and stay out of the snare's way.
- Kick interplay: the kick (or 808) track's exact onsets are listed in the context — especially under REFERENCE TRACKS. Land roots ON those onsets, or place deliberate pushes just off them; a bassline that drifts unrelated to the kick grid sounds detached from the band.
- Low-end space: the kick's transient owns its instant. Don't start a long low sub dead ON every kick hit — start subs between or just after kicks and let them ring INTO the next hit, so the sub fundamental and the kick never mask each other.
- pitch: MIDI note number. startBeat: quarter-note beats from clip start (0-based). durationBeats: quarter-note beats (> 0). velocity: 1-127, varied for groove (accents on downbeats and hand-offs, softer ghosts). slide (optional): true makes THIS note glide into the NEXT one (303 acid slide) — extend its duration slightly past the next note's start, always onto a DIFFERENT pitch, and use it sparingly (approach notes into a downbeat, chromatic walk-ups) in acid/squelch styles.${meterRulesBlock}`;
}
