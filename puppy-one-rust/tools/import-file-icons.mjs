// Run with: node tools/import-file-icons.mjs [/path/to/puppyone]
// Renders the product's own FileGlyphIcon themes (packages/shared-ui/src/file)
// to static SVG and resolves their CSS custom properties against the
// default-neutral palette, so the native Explorer shows the same glyphs.
// Output: assets/file-icons.json { kinds, themes: { id: { kind: { light, dark } } } }.
// A glyph whose label depends on the file extension contains the placeholder
// `QQQQ`; the native asset source substitutes the real label at load time.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applicationBlocks, resolve as resolveCss } from './css-tokens.mjs';
import { importProductModule, productRoot, root } from './product-bundle.mjs';

const product = await productRoot(process.argv[2]);
const entry = `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileGlyphIcon, FILE_ICON_THEMES, FILE_VISUAL_KINDS } from './packages/shared-ui/src/file/fileIcons.tsx';
import { FILE_FORMATS, getSemanticKindForFormat } from './packages/shared-ui/src/core/fileFormats.ts';
export const themes = FILE_ICON_THEMES.map((t) => t.id);
export const kinds = [...FILE_VISUAL_KINDS];
export function render(theme, kind) {
  return renderToStaticMarkup(createElement(FileGlyphIcon, { name: kind === 'folder' ? 'folder' : 'x.qqqq', type: kind, size: 18, theme }));
}
export const formats = FILE_FORMATS.map((f) => ({
  kind: getSemanticKindForFormat(f),
  filenames: f.filenames ?? [],
  extensions: f.extensions ?? [],
  patterns: f.filenamePatterns ?? [],
}));
`;
{
  const bundle = await importProductModule(product, entry);

  // Palette: the default-neutral theme the Explorer renders with.
  const neutral = applicationBlocks(await readFile(path.join(product, 'sub-themes/default-neutral/theme.css'), 'utf8'));
  const lightVars = neutral.light;
  const darkVars = { ...neutral.light, ...neutral.dark };
  const resolve = (value, vars) => resolveCss(value, vars);
  const svgFor = (markup, vars) => markup
    .replace(/<svg /, '<svg xmlns="http://www.w3.org/2000/svg" ')
    .replace(/(fill|stroke|font-family|font-size|style|stop-color)="([^"]*)"/g, (_, attr, value) => `${attr}="${resolve(value, vars)}"`);

  const themes = {};
  for (const theme of bundle.themes) {
    themes[theme] = {};
    for (const kind of bundle.kinds) {
      const markup = bundle.render(theme, kind);
      const light = svgFor(markup, lightVars);
      const dark = svgFor(markup, darkVars);
      if (/var\(|color-mix/.test(light + dark)) throw new Error(`unresolved CSS in ${theme}/${kind}`);
      themes[theme][kind] = { light, dark };
    }
  }
  const kinds = { filenames: {}, extensions: {}, patterns: [] };
  for (const format of bundle.formats) {
    for (const name of format.filenames) kinds.filenames[name.toLowerCase()] ??= format.kind;
    for (const ext of format.extensions) kinds.extensions[ext.toLowerCase()] ??= format.kind;
    for (const pattern of format.patterns) kinds.patterns.push([pattern.toLowerCase(), format.kind]);
  }
  const output = { source: 'packages/shared-ui/src/file + src/core/fileFormats.json', order: bundle.themes, kinds, themes };
  await writeFile(path.join(root, 'assets/file-icons.json'), JSON.stringify(output) + '\n');
  console.log(`File icons: ${bundle.themes.length} themes × ${bundle.kinds.length} kinds; ${Object.keys(kinds.extensions).length} extensions`);
}
