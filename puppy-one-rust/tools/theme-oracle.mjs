// Run with: node tools/theme-oracle.mjs [/path/to/puppyone]
// Lists fixtures/themes/folder with the product's own theme service
// (electron/main/themes/theme-service.mjs) and records what it accepts, what
// it rejects and why, plus each accepted Application theme's palette: the
// compiled CSS cascaded over the Neutral fallback and resolved like
// tools/import-themes.mjs. The native service must reproduce this file.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applicationBlocks, PALETTE_TOKENS, resolve } from './css-tokens.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const config = JSON.parse(await readFile(path.join(root, 'product-source.json'), 'utf8'));
const product = path.resolve(process.argv[2] ?? process.env.PUPPYONE_PRODUCT_ROOT ?? path.join(root, config.checkout));
const { createThemeService } = await import(pathToFileURL(path.join(product, 'electron/main/themes/theme-service.mjs')));
const postcss = createRequire(path.join(product, 'package.json'))('postcss');

const NEUTRAL = applicationBlocks(await readFile(path.join(root, 'assets/themes/builtin/default-neutral.css'), 'utf8'));
const userData = await mkdtemp(path.join(os.tmpdir(), 'puppyone-theme-oracle-'));
try {
  await cp(path.join(root, 'fixtures/themes/folder'), path.join(userData, 'themes'), { recursive: true });
  const service = createThemeService({ userDataPath: userData, shell: { openPath: async () => '' } });
  const snapshot = await service.listThemes();
  const themes = snapshot.themes.map((theme) => ({
    id: theme.id,
    name: theme.name,
    version: theme.version,
    ...(theme.author ? { author: theme.author } : {}),
    modes: [...theme.modes],
    targets: [...theme.targets],
    compatibleRootThemeIds: [...theme.compatibleRootThemeIds],
    source: theme.source,
    ...(theme.compiledCss.application ? { palette: palette(theme.compiledCss.application, theme.modes) } : {}),
  }));
  // PostCSS names a parse failure by the process's working directory.
  const cwd = `${process.cwd()}${path.sep}`;
  const diagnostics = snapshot.diagnostics.map(({ source, message }) => ({ source, message: message.replaceAll(cwd, '') }));
  await writeFile(path.join(root, 'fixtures/themes/oracle.json'), JSON.stringify({ themes, diagnostics }, null, 1) + '\n');
  console.log(`Theme oracle: ${themes.length} themes, ${diagnostics.length} diagnostics`);
} finally {
  await rm(userData, { recursive: true, force: true });
}

/** Compiled rules apply in source order: `host` in both modes,
 * `host:where(.dark)` in dark only, over the Neutral fallback. */
function palette(css, modes) {
  const shared = [];
  const dark = [];
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent.type !== 'root') return;
    const isDark = rule.selectors.every((s) => s.includes(':where(.dark)'));
    rule.walkDecls((d) => {
      dark.push([d.prop, d.value]);
      if (!isDark) shared.push([d.prop, d.value]);
    });
  });
  const project = (vars, mode) => Object.fromEntries(PALETTE_TOKENS.map((name) => [
    name, resolve(lightDark(`var(--po-${name})`, vars, mode), vars),
  ]));
  const out = {};
  if (modes.includes('light')) out.light = project({ ...NEUTRAL.light, ...Object.fromEntries(shared) }, 'light');
  if (modes.includes('dark')) out.dark = project({ ...NEUTRAL.light, ...NEUTRAL.dark, ...Object.fromEntries(dark) }, 'dark');
  return out;
}
/** `light-dark(a, b)` (simple arguments) picks by the host's colour scheme. */
function lightDark(value, vars, mode, depth = 0) {
  const substituted = value.replace(/var\((--[a-z0-9-]+)\)/g, (m, name) => (vars[name] && depth < 24 ? lightDark(vars[name], vars, mode, depth + 1) : m));
  return substituted.replace(/light-dark\(\s*([^,()]+(?:\([^()]*\))?)\s*,\s*([^,()]+(?:\([^()]*\))?)\s*\)/g, (_, a, b) => (mode === 'dark' ? b : a));
}
