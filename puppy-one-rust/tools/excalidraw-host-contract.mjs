// Check the pinned product's complete SDK patch set, without mutating dependencies.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export async function hostPatcher(product) {
  return import(pathToFileURL(path.join(product, 'scripts/patch-excalidraw-host-integration.mjs')));
}
export function requireInstalledHostPatches(source, build, patcher) {
  const result = patcher.patchExcalidrawHostIntegration(source, build);
  if (result.changed) throw new Error(`Excalidraw ${build} is missing required host patches; run the pinned product dependency setup before importing`);
}
