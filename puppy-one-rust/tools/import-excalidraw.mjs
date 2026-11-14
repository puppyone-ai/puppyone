#!/usr/bin/env node
// Bundle the product's Excalidraw whiteboard (tools/excalidraw-entry.tsx)
// against the product sources into assets/web/excalidraw.{js,css} with a
// provenance receipt (assets/web/excalidraw.json) that also pins the SDK
// and lists its fonts. `--check` fails on drift.
//
// The SDK is built from its production export, as the product's Vite build
// does, with the same two rewrites as its `excalidrawAssetsPlugin`
// (scripts/desktop/build/excalidraw-assets-plugin.mjs):
// - the CDN font fallback points at the app's own fonts
//   (`__assets__/excalidraw/`), never the network;
// - the scene's callback unsubscribe is idempotent, so a text element being
//   typed can be retired when the board is replaced.
// The product's postinstall host patches
// (scripts/patch-excalidraw-host-integration.mjs) are already in the
// checkout's node_modules; the build refuses an unpatched SDK.
//
// The fonts (13 MB, mostly Xiaolai's CJK shards) are not bundled: they are
// served from disk (tools/fetch-excalidraw-fonts.py installs them).
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {root} from './product-bundle.mjs';
import {bundleProductPage, BASE_STYLES} from './product-web-bundle.mjs';

const PACKAGE = '@excalidraw/excalidraw';
const ASSET_PATH = 'new URL("__assets__/excalidraw/", document.baseURI).href';
const rewrites = {fallback: 0, unsubscribe: 0, patched: 0};
const sdkRewrites = {
  name: 'excalidraw-assets',
  setup(build) {
    build.onLoad({filter: /[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/]prod[\\/].*\.js$/}, async args => {
      let contents = await readFile(args.path, 'utf8');
      if (contents.includes('Puppyone desktop breakpoint')) rewrites.patched++;
      contents = contents.replace(/`https:\/\/esm\.sh\/\$\{[^;\n]+?\/dist\/prod\/`/g, () => {
        rewrites.fallback++;
        return ASSET_PATH;
      });
      contents = contents.replace(
        /\(\)\s*=>\s*\{\s*if\s*\(!this\.callbacks\.has\((\w+)\)\)\s*\{?\s*throw (?:new )?Error(?:\(\))?;?\s*\}?\s*this\.callbacks\.delete\(\1\)/g,
        (_, id) => {
          rewrites.unsubscribe++;
          return `() => { this.callbacks.delete(${id})`;
        });
      return {contents, loader: 'js'};
    });
  },
};

const {product, modules, receipt} = await bundleProductPage({
  name: 'excalidraw',
  entry: 'tools/excalidraw-entry.tsx',
  conditions: ['production'],
  plugins: [sdkRewrites],
  packages: [PACKAGE],
  styles: [
    ...BASE_STYLES.slice(0, -1),
    `node_modules/${PACKAGE}/dist/prod/index.css`,
    'src/shared-ui/editor/viewers/excalidraw/whiteboard.css',
    BASE_STYLES.at(-1),
  ],
  // The SDK's own interface font, beside the others on disk.
  cssExternal: ['*.woff2'],
  cssRewrite: text => text.replace(/url\((["']?)\.\/fonts\//g, 'url($1excalidraw/fonts/'),
});
for (const [name, count] of Object.entries(rewrites)) {
  if (!count) throw new Error(`The Excalidraw SDK no longer matches the ${name} rewrite`);
}

// The font files the SDK names, with their digests, for the fetcher and the
// packager to verify.
const fonts = path.join(modules, PACKAGE, 'dist/prod/fonts');
const files = (await readdir(fonts, {recursive: true}))
  .filter(name => /\.(woff2?|ttf)$/i.test(name))
  .map(name => name.split(path.sep).join('/'))
  .sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = Object.fromEntries(await Promise.all(files.map(async name =>
  [name, hash(await readFile(path.join(fonts, name)))])));
// The SDK's license and its fonts' notices, as the product ships them.
const outputs = {
  'assets/web/excalidraw-fonts.json':
    JSON.stringify({package: PACKAGE, version: receipt.packages[PACKAGE], fonts: manifest}, null, 1) + '\n',
};
for (const file of ['LICENSE', 'FONT-NOTICES.txt']) {
  outputs[`licenses/excalidraw/${file}`] = await readFile(path.join(product, 'licenses/excalidraw', file), 'utf8');
}
if (process.argv.includes('--check')) {
  for (const [file, text] of Object.entries(outputs)) {
    if (await readFile(path.join(root, file), 'utf8').catch(() => null) !== text) {
      throw new Error(`Stale ${file} (run node tools/import-excalidraw.mjs)`);
    }
  }
  console.log(`excalidraw fonts and licenses verified (${files.length} fonts)`);
} else {
  for (const [file, text] of Object.entries(outputs)) {
    await mkdir(path.dirname(path.join(root, file)), {recursive: true});
    await writeFile(path.join(root, file), text);
  }
  console.log(`excalidraw fonts listed (${files.length}) and licenses copied`);
}
