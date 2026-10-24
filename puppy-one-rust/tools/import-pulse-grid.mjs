// Run with: node tools/import-pulse-grid.mjs [/path/to/puppyone]
// Projects the product loading-animation presets (PulseGrid) to frame data.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { importProductModule, productRoot, root } from './product-bundle.mjs';

const product = await productRoot(process.argv[2]);
const bundle = await importProductModule(product, `
import { PULSE_GRID_PRESET_IDS, PULSE_GRID_PRESET_FRAMES, DEFAULT_PULSE_GRID_FRAME_DURATION_MS, getPulseGridPointAppearance } from './packages/shared-ui/src/primitives/pulseGridSequence.ts';
export const ids = [...PULSE_GRID_PRESET_IDS];
export const duration = DEFAULT_PULSE_GRID_FRAME_DURATION_MS;
export const presets = Object.fromEntries(PULSE_GRID_PRESET_IDS.map((id) => [id,
  PULSE_GRID_PRESET_FRAMES[id].map((frame) => Array.from({ length: 9 }, (_, p) => getPulseGridPointAppearance(frame, p).brightness))]));
`);
const output = { source: 'packages/shared-ui/src/primitives/pulseGridSequence.ts', frameDurationMs: bundle.duration, order: bundle.ids, presets: bundle.presets };
await writeFile(path.join(root, 'assets/pulse-grid.json'), JSON.stringify(output) + '\n');
console.log(`Pulse grid: ${bundle.ids.join(', ')} @ ${bundle.duration}ms`);
