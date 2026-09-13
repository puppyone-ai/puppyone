#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { inspectStyleLayers } from "../tooling/styles/style-layer-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const cascade = read("src/styles/cascade.css");
const rendererEntry = read("src/main.tsx");
const productStyles = read("src/styles.css");
const tailwindEntry = read("src/cloud-globals.css");
const tailwindConfig = read("tailwind.config.cjs");
const windowChromeStyles = read("src/styles/window-chrome.css");
const interfaceSkinContractStyles = read("src/styles/interface-skin-contract.css");
const windowChromeOwner = path.join(repoRoot, "src", "styles", "window-chrome.css");
const sharedUiRoot = path.join(repoRoot, "packages", "shared-ui", "src");
const interfaceStyleRoot = path.join(repoRoot, "src", "styles", "interfaces");
const builtinSubThemeRoot = path.join(repoRoot, "sub-themes");
const viewerSurfaceTokenContract = JSON.parse(read("src/styles/viewer-surface-token-contract.json"));
const concreteStylePattern = /\bwindows-xp\b/;
const editorInternalSelectorPattern = /\.(?:cm-|markdown-codemirror-editor\b|csv-table-editor\b|desktop-terminal-xterm\b|puppyflow-[a-z0-9-]+\b|editor-mode-toggle\b|plain-text-editor\b|code-codemirror-editor\b)/;
const genericFormControlPattern = /(^|[\s>:,(])(?:input|textarea|select)(?=[\s.#:[>,+~]|$)/;
const ownedFormControlScopePattern = /\.(?:desktop-settings-view|desktop-settings-switch|desktop-dialog-surface|onboarding-shell|desktop-agent-composer)\b/;
const rootRelativeAssetPattern = /(["'`])\/(?!\/)[^"'`]+\.(?:png|svg|webp|jpe?g|gif|ico|woff2?)(?:[?#][^"'`]*)?\1/gi;

if (cascade.trim() !== "@layer reset, fallback, tokens, primitives, patterns, features, interface-style, sub-theme, appearance-overrides, accessibility, overrides;") {
  errors.push("Renderer cascade order must keep Root Theme → Sub Theme → semantic User Overrides → safety layers explicit.");
}

const cascadeIndex = rendererEntry.indexOf('import "./styles/cascade.css";');
const tailwindIndex = rendererEntry.indexOf('import "./cloud-globals.css";');
const productIndex = rendererEntry.indexOf('import "./styles.css";');
const rendererStyleBootstrap = [
  'import "./styles/cascade.css";',
  'import "./cloud-globals.css";',
  'import "./styles.css";',
].join("\n");
if (
  cascadeIndex < 0
  || tailwindIndex < 0
  || productIndex < 0
  || !rendererEntry.startsWith(`${rendererStyleBootstrap}\n`)
  || !(cascadeIndex < tailwindIndex && tailwindIndex < productIndex)
) {
  errors.push("Renderer styles must be the first side-effect imports and load cascade registration, layered Tailwind, then product styles before application modules.");
}

if (!/corePlugins\s*:\s*\{[\s\S]*?preflight\s*:\s*false/.test(tailwindConfig)) {
  errors.push("Tailwind Preflight must remain disabled; PuppyOne's reset layer is the only renderer reset owner.");
}

if (!productStyles.includes('@import "./styles/base.css" layer(reset);')) {
  errors.push("The PuppyOne base stylesheet must remain explicitly owned by the reset layer.");
}

if (!productStyles.includes('@import "./styles/fallback-theme.generated.css" layer(fallback);')) {
  errors.push("The generated Neutral recovery palette must remain in the lowest fallback layer.");
}

if (!productStyles.includes('@import "@puppyone/shared-ui/shared-ui-patterns.css" layer(patterns);')) {
  errors.push("Shared UI patterns must participate in the named patterns layer before product features and Interface Styles.");
}

if (!productStyles.includes('@import "@puppyone/shared-ui/editor.css";')) {
  errors.push("Viewer editor CSS must retain its explicit unlayered runtime authority over CodeMirror's injected base theme.");
}

for (const match of productStyles.matchAll(/^@import\s+([^;]+);$/gm)) {
  if (
    match[1].includes("interface-styles.generated.css")
    || match[1].includes("@puppyone/shared-ui/editor.css")
    || match[1].includes("desktop-agent/ui/styles/agent-prompt-editor.css")
  ) continue;
  if (!match[1].includes("layer(")) {
    errors.push(`Product stylesheet import is outside the named cascade: ${match[0]}`);
  }
}

if (!productStyles.includes('@import "./styles/window-chrome.css" layer(features);')) {
  errors.push("Desktop product styles must load the dedicated native window chrome contract.");
}

if (
  !windowChromeStyles.includes('[data-window-drag-region="true"]')
  || !windowChromeStyles.includes("-webkit-app-region: drag;")
  || !windowChromeStyles.includes('[data-window-no-drag="true"]')
  || !windowChromeStyles.includes("-webkit-app-region: no-drag;")
) {
  errors.push("Window chrome styles must own explicit drag and no-drag data-attribute contracts.");
}

const expectedTailwindDirectives = ["@tailwind base;", "@tailwind components;", "@tailwind utilities;"];
for (const directive of expectedTailwindDirectives) {
  if (!tailwindEntry.includes(directive)) errors.push(`Tailwind entry is missing ${directive}`);
}
if (!tailwindEntry.includes("@layer reset") || !tailwindEntry.includes("@layer features")) {
  errors.push("Tailwind output must participate in the reset/features cascade layers.");
}

const rendererSourceRoots = [
  path.join(repoRoot, "src"),
  path.join(repoRoot, "packages", "shared-ui", "src"),
];

// Check feature-side imports too, including every transitive CSS import edge.
const auxiliaryStyleRoots = ["src/features/app-shell/auxiliary-workbench", "src/features/desktop-terminal", "src/features/desktop-agent"];
const checkedStyles = new Set();
function checkAuxiliaryStyle(filePath, layered = false) {
  const key = `${filePath}:${layered}`;
  if (checkedStyles.has(key)) return;
  checkedStyles.add(key);
  const contract = inspectStyleLayers(readAbsolute(filePath), layered);
  for (const selector of contract.unlayeredRules) {
    errors.push(`${path.relative(repoRoot, filePath)} escapes the named cascade: ${selector}`);
  }
  for (const entry of contract.imports) {
    if (entry.path.startsWith(".")) checkAuxiliaryStyle(path.resolve(path.dirname(filePath), entry.path), entry.layered);
    else if (!entry.layered) errors.push(`${filePath} imports unlayered vendor CSS: ${entry.path}`);
  }
}
for (const directory of auxiliaryStyleRoots) {
  for (const filePath of walkRendererSource(path.join(repoRoot, directory)).filter(file => /\.tsx?$/.test(file))) {
    const parsed = ts.createSourceFile(filePath, readAbsolute(filePath), ts.ScriptTarget.Latest, true);
    for (const statement of parsed.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.endsWith(".css")) continue;
      if (specifier.startsWith(".")) checkAuxiliaryStyle(path.resolve(path.dirname(filePath), specifier));
      else errors.push(`${path.relative(repoRoot, filePath)} must import vendor CSS through a layered style entry: ${specifier}`);
    }
  }
}

const promptAdapter = read("src/features/desktop-agent/ui/styles/agent-prompt-editor.css");
if (promptAdapter.includes("!important")) errors.push("Agent prompt adapter must share CodeMirror's unlayered tier without important overrides.");
if (read("src/features/desktop-agent/ui/styles/theme.css").includes("--po-terminal-")) {
  errors.push("Agent Chat must consume its own surface role, not Terminal tokens.");
}

for (const filePath of rendererSourceRoots.flatMap(walkRendererSource)) {
  const relativePath = path.relative(repoRoot, filePath);
  const source = readAbsolute(filePath);

  if (
    filePath.endsWith(".css")
    && relativePath !== path.join("src", "cloud-globals.css")
    && /^\s*@tailwind\s+(?:base|components|utilities)\s*;/m.test(source)
  ) {
    errors.push(`${relativePath} declares Tailwind globally; src/cloud-globals.css is the single entry owner.`);
  }

  if (
    filePath !== windowChromeOwner
    && /(?:-webkit-)?app-region\b|WebkitAppRegion|webkitAppRegion/.test(source)
  ) {
    errors.push(`${relativePath} declares native window hit testing; src/styles/window-chrome.css is the single owner.`);
  }

  if (!filePath.endsWith(".css")) {
    const rootRelativeAssets = source.match(rootRelativeAssetPattern) ?? [];
    if (rootRelativeAssets.length > 0) {
      errors.push(`${relativePath} uses root-relative renderer assets (${rootRelativeAssets.join(", ")}); use resolveRendererPublicAssetUrl().`);
    }
  }
  if (/editorPresentation|data-editor-presentation|follow-interface|product-default/.test(source)) {
    errors.push(`${relativePath} retains the retired Editor presentation override; Interface Style must directly own Editor presentation.`);
  }
}

for (const filePath of walkRendererSource(sharedUiRoot)) {
  const source = readAbsolute(filePath);
  if (/data-window-(?:drag-region|no-drag)/.test(source)) {
    errors.push(`${path.relative(repoRoot, filePath)} leaks desktop native window behavior into Shared UI.`);
  }
  if (/data-interface-style/.test(source)) {
    errors.push(`${path.relative(repoRoot, filePath)} branches on a Desktop Interface Style; consume a semantic surface/component token instead.`);
  }
  if (concreteStylePattern.test(source)) {
    errors.push(`${path.relative(repoRoot, filePath)} references a concrete Desktop Interface Style; MDI and editors must remain Style-agnostic.`);
  }
  if (/ThemeSurfaceContext|useThemeSurfaceId|data-sub-theme-id|ThemeCatalog/.test(source)) {
    errors.push(`${path.relative(repoRoot, filePath)} imports product Sub Theme identity into Shared UI; consume semantic tokens and the generic appearance revision only.`);
  }
}

for (const filePath of readdirSync(builtinSubThemeRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(builtinSubThemeRoot, entry.name, "theme.css"))) {
  const relativePath = path.relative(repoRoot, filePath);
  const source = readAbsolute(filePath);
  if (editorInternalSelectorPattern.test(source)) {
    errors.push(`${relativePath} targets Editor internals; built-in Sub Themes must use the public token contract.`);
  }
  if (!source.includes("@puppyone-theme") || !source.includes("@puppyone ")) {
    errors.push(`${relativePath} is not a self-describing single-file Sub Theme package.`);
  }
  if (/--po-host-(?:md|csv)-/.test(source)) {
    errors.push(`${relativePath} authors private host tokens; use the public Sub Theme token contract.`);
  }
}

const interfaceStyleFiles = walkCss(interfaceStyleRoot);

for (const filePath of interfaceStyleFiles) {
  const source = readAbsolute(filePath);
  const relativePath = path.relative(repoRoot, filePath);
  if (editorInternalSelectorPattern.test(source)) {
    errors.push(`${relativePath} targets Editor internals; project semantic custom properties at a Viewer surface boundary instead.`);
  }
  validateOwnedFormControlSelectors(relativePath, source);
  if (filePath.includes(`${path.sep}surfaces${path.sep}`)) {
    validateSurfaceTokenProjection(relativePath, source);
  }
}

if (editorInternalSelectorPattern.test(interfaceSkinContractStyles)) {
  errors.push("src/styles/interface-skin-contract.css targets Editor internals; project semantic custom properties at a Viewer surface boundary instead.");
}
validateOwnedFormControlSelectors("src/styles/interface-skin-contract.css", interfaceSkinContractStyles);

for (const filePath of walkRendererSource(path.join(repoRoot, "src", "features", "appearance"))) {
  if (/surfaceAdapters|SurfaceAdapter/.test(readAbsolute(filePath))) {
    errors.push(`${path.relative(repoRoot, filePath)} exposes runtime Style × Viewer adapter routing; Style surfaces must be build-time token projections.`);
  }
}

if (errors.length > 0) {
  console.error("Renderer style architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Renderer style architecture check passed.");

function read(relativePath) {
  return readAbsolute(path.join(repoRoot, relativePath));
}

function readAbsolute(filePath) {
  return readFileSync(filePath, "utf8");
}

function walkRendererSource(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkRendererSource(filePath);
    return statSync(filePath).isFile() && /\.(?:css|[cm]?[jt]sx?)$/.test(filePath) ? [filePath] : [];
  });
}

function walkCss(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkCss(filePath);
    return statSync(filePath).isFile() && filePath.endsWith(".css") ? [filePath] : [];
  });
}

function validateSurfaceTokenProjection(relativePath, source) {
  if (!source.includes(".po-viewer-surface-boundary")) {
    errors.push(`${relativePath} is a Viewer surface pack but does not scope tokens to .po-viewer-surface-boundary.`);
  }
  if (!source.includes("[data-interface-style=")) {
    errors.push(`${relativePath} does not bind its Viewer projection directly to an Interface Style.`);
  }
  for (const match of source.matchAll(/\{([^{}]*)\}/gs)) {
    const declarations = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean);
    for (const declaration of declarations) {
      const tokenMatch = declaration.match(/^(--po-[a-z0-9-]+)\s*:\s*(.+)$/s);
      if (!tokenMatch) {
        errors.push(`${relativePath} contains a non-token surface declaration (${declaration}); Viewer surface packs may declare --po-* custom properties only.`);
        continue;
      }
      const [, token, value] = tokenMatch;
      const definition = viewerSurfaceTokenContract.tokens[token];
      if (!definition) {
        errors.push(`${relativePath} declares unknown Viewer surface token ${token}; add it to the versioned token contract first.`);
        continue;
      }
      if (definition.type === "dimension" && !isDimensionWithinContract(value.trim(), definition)) {
        errors.push(`${relativePath} assigns ${token}: ${value.trim()}, outside its ${definition.min}-${definition.max}${definition.unit} contract.`);
      }
    }
  }
}

function validateOwnedFormControlSelectors(relativePath, source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const selector = match[1].trim();
    if (selector.startsWith("@") || !genericFormControlPattern.test(selector)) continue;
    if (!ownedFormControlScopePattern.test(selector)) {
      errors.push(`${relativePath} styles a generic form control without a feature-owned scope (${selector}); Interface Styles must not penetrate Viewer/editor controls.`);
    }
  }
}

function isDimensionWithinContract(value, definition) {
  const match = value.match(/^(-?\d+(?:\.\d+)?)([a-z%]+)$/i);
  if (!match || match[2] !== definition.unit) return false;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) && numeric >= definition.min && numeric <= definition.max;
}
