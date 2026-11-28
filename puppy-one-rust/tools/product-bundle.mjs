// Bundle and import a small entry module against the real product sources, so
// native asset importers reuse product logic instead of re-deriving it.
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveProductRoot } from './product-source.mjs';

export const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export async function productRoot(argument) {
  return resolveProductRoot(argument);
}
export async function importProductModule(product, contents) {
  const require = createRequire(path.join(product, 'package.json'));
  const esbuild = require('esbuild');
  const work = await mkdtemp(path.join(os.tmpdir(), 'puppyone-product-'));
  try {
    const outfile = path.join(work, 'bundle.mjs');
    await esbuild.build({
      stdin: { contents, resolveDir: product, loader: 'tsx', sourcefile: 'entry.tsx' },
      bundle: true,
      platform: 'node',
      format: 'esm',
      jsx: 'automatic',
      outfile,
      nodePaths: [path.join(product, 'node_modules')],
      loader: { '.json': 'json', '.css': 'empty', '.svg': 'empty' },
      logLevel: 'error',
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    });
    return await import(pathToFileURL(outfile));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
