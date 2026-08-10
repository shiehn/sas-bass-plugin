# Bass Generator Plugin

A [Signals & Sorcery](https://signalsandsorcery.com) plugin dedicated to electronic basslines — describe one bassline and get a single monophonic line mechanically partitioned across multiple tracks — typically 1–3, with no upper bound — each with its own Surge XT sound.

<p align="center">
  <img src="assets/signals-and-sorcery.png" alt="Signals & Sorcery" width="420" />
</p>

> Part of the **[Signals & Sorcery](https://signalsandsorcery.com)** ecosystem.

## What it does

- One prompt ("disco octave bass", "constant 16th pump", "dark roller into a sub drop") composes ONE strictly monophonic bassline — never chords, never layers
- **Multi-voice with no upper bound**: most lines land on 1–3 voices naturally (especially short loops); wide or long repetitive lines earn more — the only ceiling is the app's 16-track budget
- A **mechanical analyzer** (not the LLM) splits the line across voice tracks:
  - **Register split** — e.g. an octave bass becomes a low track and a high track at the largest pitch gap
  - **Metric split** — downbeats (1,2,3,4), 8th offbeats (&), and 16th offbeats (e,a) become their own tracks
  - **Variety voice** — on long repetitive lines, phrase-boundary notes are extracted every 4 bars so a different timbre answers symmetrically (the more repetition, the more variety)
- The voices form one horizontal line (a hocket): timbre changes note-to-note while the ear hears a single bassline
- Each voice's Surge XT preset is chosen by range analysis of its actual notes — sustained subs draw low presets, mid stabs draw high ones — with sibling sounds excluded so every voice starts distinct
- Regeneration reconciles the voice group and **never replaces a sound you picked**; per-voice 🎲 shuffle, sound history, FX chain, and piano-roll editing all work per track
- **Copy a voice** (⧉ on any voice row): a deep copy — same notes and preset by value, brand-new track identity, no pointer to the original — appended to the group, muted, ready to re-sound
- **Import Bassline** (panel header): reuse a part you already made — a bass track copied faithfully (MIDI + preset + FX) from another scene, or a MIDI part pulled across from another panel in this one. The sound comes too: a part ported from any Surge-based panel (synth, arp, pad, ensemble) keeps its patch, and only a source Surge cannot load — a third-party instrument, a drum sample — falls back to a fresh bass preset. Either way it arrives as a bassline group of one, so the next Generate re-partitions it into voices while keeping the imported sound

## Install

From within Signals & Sorcery: **Settings > Manage Plugins > Add Plugin** and enter:

```
https://github.com/shiehn/sas-bass-plugin
```

Or clone manually into `~/.signals-and-sorcery/plugins/@signalsandsorcery/bass-generator/`.

## Capabilities

| Capability | Required |
|------------|----------|
| `requiresLLM` | Yes - AI bassline composition |
| `requiresSurgeXT` | Yes - synth preset loading |

## Development

Built with the [@signalsandsorcery/plugin-sdk](https://github.com/shiehn/sas-plugin-sdk) — this panel is a thin adapter over the SDK's shared generator-panel core. See the [Plugin SDK docs](https://signalsandsorcery.com/plugin-sdk/) for the full API reference.

```bash
npm install
npm test        # analyzer + validation + reconcile suites
npm run build   # tsup → dist/
```

The split heuristics (register gap, metric class shares, repetition thresholds) are exported constants in `src/split-bass-line.ts` and `src/variety-voice.ts` — tune them by ear.

## The Signals & Sorcery Ecosystem

- **[Signals & Sorcery](https://signalsandsorcery.com)** — the flagship AI music production workstation
- **[sas-plugin-sdk](https://github.com/shiehn/sas-plugin-sdk)** — TypeScript SDK for building generator plugins
- **[sas-synth-plugin](https://github.com/shiehn/sas-synth-plugin)** — AI-powered MIDI patterns with Surge XT synthesis
- **[sas-loops-plugin](https://github.com/shiehn/sas-loops-plugin)** — Audio loop / sample library browser with time-stretching
- **[sas-stems-plugin](https://github.com/shiehn/sas-stems-plugin)** — AI audio-from-text generation with stem splitting

<p align="center">
  <a href="https://signalsandsorcery.com">signalsandsorcery.com</a>
</p>

## License

MIT
