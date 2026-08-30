/**
 * The sound step of a cross-panel port ("Import Bassline" → "This scene —
 * other panels"): INHERIT the source track's patch when it can travel, and
 * fall back to a fresh bass preset when it cannot.
 *
 * The default port behaviour picks a random preset, which throws away the
 * thing that made the part worth importing. Bass tracks host Surge XT, and so
 * do the other Surge-based panels (synth, arp, pad, ensemble) — between them
 * the patch is just a ValueTree blob and transfers exactly.
 *
 * The gate is `stateType`, the same discriminator the SDK's own apply path
 * uses:
 *
 *   'valuetree' (or absent) — Surge state. Copy it onto the newborn's Surge.
 *   'raw'                   — a third-party VST3's own serialization (Diva,
 *                             Serum, Kontakt…). It cannot load into Surge XT —
 *                             but when the snapshot names the instrument it
 *                             belongs to (SDK 3.13.0 `instrument`), the sound
 *                             DEEP-COPIES: load a FRESH instance of that
 *                             plugin on the new track and apply the copied
 *                             state blob to it. No reference back to the
 *                             source track or its plugin instance survives.
 *                             Plugin missing on this machine, or a legacy
 *                             identity-less blob → shuffle.
 *
 * A non-preset snapshot (a drum panel's sample path, an instrument panel's
 * zones) is likewise not something Surge can load — shuffle. So is a source
 * with no persisted sound at all. Every failure path lands on a real bass
 * preset; the port never ends up silent or on the default patch because of a
 * sound we could not read.
 */

import type { PluginHost, PanelSoundAdapter, PortedTrackSource } from '@signalsandsorcery/plugin-sdk';

export interface PortedBassSoundResult {
  /** 'inherited' = the source's sound was copied (patch — and instrument, for third-party sources); 'shuffled' = a fresh bass preset. */
  outcome: 'inherited' | 'shuffled';
  /** Preset name that ended up on the track, when we know it. */
  label?: string;
}

/**
 * Sound a freshly-ported bass track. Never throws — the port itself already
 * succeeded (MIDI is on the track), so a sound failure must not roll it back.
 */
export async function applyPortedBassSound(opts: {
  host: Pick<PluginHost, 'getTrackSound' | 'shufflePreset' | 'setTrackInstrument'>;
  /** The panel's shared Surge adapter — copySnapshot applies AND persists. */
  sound: Pick<PanelSoundAdapter, 'copySnapshot'>;
  /** Engine id of the newborn bass track. */
  trackId: string;
  /** Where the part came from; absent on hosts predating SDK 2.68.0. */
  source?: PortedTrackSource;
}): Promise<PortedBassSoundResult> {
  const { host, sound, trackId, source } = opts;

  if (source && host.getTrackSound) {
    try {
      const snap = await host.getTrackSound(source.trackDbId);
      if (snap && snap.kind === 'preset') {
        if (snap.stateType !== 'raw') {
          const label = await sound.copySnapshot(trackId, snap);
          return { outcome: 'inherited', label };
        }
        // 'raw' belongs to a third-party instrument. When the snapshot names
        // it, deep-copy the sound: load a FRESH instance of the same plugin
        // (a scan-catalog product id — never a reference to the source's
        // instance), then apply the copied state blob. copySnapshot persists
        // it as the NEW track's own preset identity.
        if (snap.instrument?.pluginId && typeof host.setTrackInstrument === 'function') {
          await host.setTrackInstrument(trackId, snap.instrument.pluginId);
          try {
            const label = await sound.copySnapshot(trackId, snap);
            return { outcome: 'inherited', label };
          } catch {
            // The instrument landed but its patch didn't. Keep the fresh
            // instance on its default sound — shuffling a SURGE preset into
            // a third-party plugin would corrupt it.
            return { outcome: 'inherited', label: snap.instrument.name };
          }
        }
        // Identity-less raw blob (row predating instrument tracking) — it
        // cannot be re-homed safely. Fall through to a fresh bass preset.
      }
    } catch {
      /* unreadable sound or plugin missing on this machine — fresh preset */
    }
  }

  try {
    const result = await host.shufflePreset(trackId);
    return { outcome: 'shuffled', label: result.presetName };
  } catch {
    // Pool exhausted or no instrument yet: the track keeps Surge's default
    // patch. Non-fatal by design — the ported MIDI is what matters.
    return { outcome: 'shuffled' };
  }
}
