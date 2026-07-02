/**
 * @signalsandsorcery/bass-generator — plugin entry.
 *
 * Dedicated electronic bassline generator: one prompt → the LLM composes a
 * single strictly-monophonic line → a mechanical analyzer partitions it
 * across 1–3 Surge XT voice tracks (register or metric split). See
 * BassGeneratorPanel.tsx and src/split-bass-line.ts.
 */

import type { ComponentType } from 'react';
import type {
  GeneratorPlugin,
  PluginHost,
  PluginUIProps,
  PluginSettingsSchema,
} from '@signalsandsorcery/plugin-sdk';
import { BassGeneratorPanel } from './BassGeneratorPanel';
import manifest from './plugin.json';

class BassGeneratorPlugin implements GeneratorPlugin {
  readonly id = '@signalsandsorcery/bass-generator';
  readonly displayName = 'Bass';
  readonly version = '1.0.0';
  readonly description =
    'Dedicated electronic bassline generator — one prompt becomes a single monophonic line mechanically partitioned across 1–3 Surge XT voices';
  readonly generatorType = 'midi' as const;
  readonly minHostVersion = '1.0.0';

  private host: PluginHost | null = null;

  async activate(host: PluginHost): Promise<void> {
    this.host = host;
    console.log('[BassGeneratorPlugin] activated');
  }

  async deactivate(): Promise<void> {
    this.host = null;
  }

  getUIComponent(): ComponentType<PluginUIProps> {
    return BassGeneratorPanel;
  }

  getSettingsSchema(): PluginSettingsSchema | null {
    return null;
  }
}

export default BassGeneratorPlugin;
export { BassGeneratorPlugin, BassGeneratorPanel };
export const bassManifest = manifest;
