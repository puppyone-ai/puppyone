#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { compileThemeCss } from "../electron/main/themes/theme-css-compiler.mjs";
import { parseSingleFileThemeCss } from "../electron/main/themes/theme-single-file-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.join(repoRoot, "sub-themes");
const outputPath = path.join(
  repoRoot,
  "src/features/themes/builtinSubThemes.generated.ts",
);
const rootThemeManifestPath = path.join(
  repoRoot,
  "src/features/appearance/interface-style-manifest.json",
);
const checkOnly = process.argv.includes("--check");
const rootThemeManifest = JSON.parse(readFileSync(rootThemeManifestPath, "utf8"));

try {
  const definitions = await buildDefinitions();
  const fallback = validateFallbackTheme(definitions);
  const outputs = new Map([
    [outputPath, renderRegistry(definitions)],
    [path.join(repoRoot, "src/styles/fallback-theme.generated.css"), renderFallbackCss(fallback)],
    [path.join(repoRoot, "src/features/themes/subThemeBootstrap.generated.ts"), renderTypeScriptBootstrap(definitions, fallback)],
    [path.join(repoRoot, "public/sub-theme-bootstrap.js"), renderBrowserBootstrap(definitions, fallback)],
    [path.join(repoRoot, "electron/main/sub-theme-first-paint.generated.mjs"), renderNativeBootstrap(definitions, fallback)],
    [path.join(repoRoot, "public/initial-shell.css"), renderInitialShellCss(fallback)],
  ]);
  if (checkOnly) {
    const stale = [...outputs].flatMap(([candidate, expected]) => (
      existsSync(candidate) && readFileSync(candidate, "utf8") === expected
        ? []
        : [path.relative(repoRoot, candidate)]
    ));
    if (stale.length > 0) {
      console.error("Built-in Sub Theme registry is stale.");
      stale.forEach((candidate) => console.error(`- ${candidate}`));
      console.error("Run npm run generate:sub-themes and commit the generated artifacts.");
      process.exit(1);
    }
    console.log(`Built-in Sub Theme packages are valid (${definitions.length} packages).`);
  } else {
    for (const [candidate, expected] of outputs) {
      writeFileSync(candidate, expected);
      console.log(`Generated ${path.relative(repoRoot, candidate)}.`);
    }
  }
} catch (error) {
  console.error(`Built-in Sub Theme generation failed: ${formatError(error)}`);
  process.exit(1);
}

async function buildDefinitions() {
  if (!existsSync(packagesRoot)) fail("sub-themes/ does not exist.");
  const rootThemes = new Map(rootThemeManifest.styles.map((definition) => [definition.id, definition]));
  const entries = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.name !== ".DS_Store")
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length === 0) fail("sub-themes/ must contain at least one package directory.");

  const definitions = [];
  const ids = new Set();
  const orders = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory()) fail(`sub-themes/${entry.name} must be a package directory.`);
    const packageDirectory = path.join(packagesRoot, entry.name);
    const packageFiles = readdirSync(packageDirectory, { withFileTypes: true })
      .filter((candidate) => candidate.name !== ".DS_Store");
    if (
      packageFiles.length !== 1
      || !packageFiles[0].isFile()
      || packageFiles[0].name !== "theme.css"
    ) {
      fail(`sub-themes/${entry.name} must contain exactly one theme.css file.`);
    }

    const themePath = path.join(packageDirectory, "theme.css");
    const relativeThemePath = path.relative(repoRoot, themePath).split(path.sep).join("/");
    const parsed = parseSingleFileThemeCss(normalizeNewlines(readFileSync(themePath, "utf8")), {
      sourcePath: relativeThemePath,
      allowReservedBuiltinId: true,
      allowBuiltinCompatibilityMetadata: true,
    });
    if (!parsed) fail(`${relativeThemePath} must declare @puppyone-theme metadata.`);
    if (entry.name !== parsed.id.replaceAll(".", "-")) {
      fail(`${relativeThemePath} id ${parsed.id} does not match package directory ${entry.name}.`);
    }
    if (ids.has(parsed.id)) fail(`Duplicate built-in Sub Theme id: ${parsed.id}.`);
    ids.add(parsed.id);
    if (parsed.builtinOrder === undefined) {
      fail(`${relativeThemePath} must declare builtin-order.`);
    }
    if (orders.has(parsed.builtinOrder)) {
      fail(`Duplicate built-in Sub Theme order: ${parsed.builtinOrder}.`);
    }
    orders.add(parsed.builtinOrder);
    validateRootCompatibility(parsed, rootThemes, relativeThemePath);

    const compiledCss = {};
    let firstPaint;
    for (const target of parsed.targets) {
      const result = await compileThemeCss({
        css: parsed.stylesheets[target],
        themeId: parsed.id,
        target,
        sourcePath: relativeThemePath,
        supportedModes: parsed.modes,
        allowReservedBuiltinId: true,
      });
      compiledCss[target] = result.css;
      if (target === "application") firstPaint = result.firstPaint;
    }
    if (
      parsed.targets.includes("application")
      && parsed.modes.some((mode) => firstPaint?.[mode] === undefined)
    ) {
      fail(`${relativeThemePath} must declare an opaque --po-canvas for every application Color Mode.`);
    }
    definitions.push({
      id: parsed.id,
      family: parsed.id.split(".").slice(0, -1).join("."),
      name: parsed.name,
      version: parsed.version,
      contractVersion: parsed.contractVersion,
      ...(parsed.author === undefined ? {} : { author: parsed.author }),
      compatibleRootThemeIds: [...parsed.compatibleRootThemeIds],
      modes: [...parsed.modes],
      targets: [...parsed.targets],
      source: "builtin",
      compiledCss,
      ...(firstPaint === undefined ? {} : { firstPaint }),
      ...(parsed.legacyPresets === undefined
        ? {}
        : { legacyPresets: { ...parsed.legacyPresets } }),
      builtinOrder: parsed.builtinOrder,
    });
  }

  for (const rootTheme of rootThemes.values()) {
    for (const [mode, defaultSubThemeId] of Object.entries(rootTheme.subThemes.defaultSubThemeIds)) {
      const defaultSubTheme = definitions.find(
        (definition) => definition.id === defaultSubThemeId,
      );
      if (!defaultSubTheme) {
        fail(`Root Theme ${rootTheme.id} default ${mode} Sub Theme is missing: ${defaultSubThemeId}.`);
      }
      if (!defaultSubTheme.compatibleRootThemeIds.includes(rootTheme.id)) {
        fail(`Root Theme ${rootTheme.id} default ${mode} Sub Theme is not compatible with its owner.`);
      }
      if (!defaultSubTheme.modes.includes(mode)) {
        fail(`Root Theme ${rootTheme.id} default Sub Theme ${defaultSubThemeId} does not support ${mode}.`);
      }
    }
  }

  return definitions
    .sort((left, right) => left.builtinOrder - right.builtinOrder)
    .map(({ builtinOrder: _builtinOrder, ...definition }) => definition);
}

function validateFallbackTheme(definitions) {
  const fallbackId = rootThemeManifest.fallbackSubThemeId;
  if (typeof fallbackId !== "string") fail("interface-style manifest must declare fallbackSubThemeId.");
  const fallback = definitions.find((definition) => definition.id === fallbackId);
  if (!fallback) fail(`Fallback Sub Theme is missing: ${fallbackId}.`);
  if (!fallback.targets.includes("application")) fail("Fallback Sub Theme must target application.");
  if (!fallback.modes.includes("light") || !fallback.modes.includes("dark")) {
    fail("Fallback Sub Theme must support light and dark.");
  }
  if (!fallback.firstPaint?.light || !fallback.firstPaint?.dark) {
    fail("Fallback Sub Theme must declare an opaque --po-canvas for light and dark.");
  }
  return fallback;
}

function validateRootCompatibility(theme, rootThemes, relativeThemePath) {
  for (const rootThemeId of theme.compatibleRootThemeIds) {
    const rootTheme = rootThemes.get(rootThemeId);
    if (!rootTheme) {
      fail(`${relativeThemePath} references unknown Root Theme ${rootThemeId}.`);
    }
    for (const target of rootTheme.subThemes.allowedTargets) {
      if (!theme.targets.includes(target)) {
        fail(`${relativeThemePath} must cover ${rootThemeId} target ${target}.`);
      }
    }
    const supportedModes = rootTheme.palette.kind === "fixed"
      ? [rootTheme.palette.mode]
      : rootTheme.palette.modes.includes("system")
        ? ["light", "dark"]
        : rootTheme.palette.modes;
    if (!theme.modes.some((mode) => supportedModes.includes(mode))) {
      fail(`${relativeThemePath} has no Color Mode supported by Root Theme ${rootThemeId}.`);
    }
  }
}

function renderRegistry(definitions) {
  const rows = definitions.map((definition) => renderDefinition(definition, "  ")).join(",\n");
  const compiledCssConstants = definitions.map(renderCompiledCssConstant).join("\n\n");
  return [
    "/* This file is generated by scripts/generate-builtin-sub-themes.mjs. */",
    "/* Edit sub-themes/<package>/theme.css, then run npm run generate:sub-themes. */",
    'import type { SubThemeDefinition } from "./themeTypes";',
    "",
    compiledCssConstants,
    "",
    "export const GENERATED_BUILTIN_SUB_THEMES: readonly SubThemeDefinition[] = Object.freeze([",
    rows,
    "]);",
    "",
  ].join("\n");
}

function renderDefinition(definition, indent) {
  const compiledCssName = getCompiledCssConstantName(definition.id);
  const variants = definition.modes.map((mode) => (
    `${quote(mode)}: Object.freeze({ compiledCss: ${compiledCssName} })`
  ));
  const properties = [
    `id: ${quote(definition.id)}`,
    `family: ${quote(definition.family)}`,
    `name: ${quote(definition.name)}`,
    `version: ${quote(definition.version)}`,
    `contractVersion: ${definition.contractVersion}`,
    ...(definition.author === undefined ? [] : [`author: ${quote(definition.author)}`]),
    `compatibleRootThemeIds: Object.freeze(${JSON.stringify(definition.compatibleRootThemeIds)} as const)`,
    `targets: Object.freeze(${JSON.stringify(definition.targets)} as const)`,
    'source: "builtin"',
    `variants: Object.freeze({ ${variants.join(", ")} })`,
    ...(definition.firstPaint === undefined
      ? []
      : [`firstPaint: Object.freeze(${JSON.stringify(definition.firstPaint)} as const)`]),
    ...(definition.legacyPresets === undefined
      ? []
      : [`legacyPresets: Object.freeze(${JSON.stringify(definition.legacyPresets)})`]),
  ];
  return [
    `${indent}Object.freeze({`,
    ...properties.map((property) => `${indent}  ${property},`),
    `${indent}})`,
  ].join("\n");
}

function renderFallbackCss(fallback) {
  const root = postcss.parse(fallback.compiledCss.application);
  const host = `[data-po-appearance-root][data-sub-theme-id="${fallback.id}"]`;
  root.walkRules((rule) => {
    rule.selector = rule.selector
      .split(",")
      .map((selector) => selector.trim())
      .map((selector) => {
        if (selector === host) return ":root, :where([data-po-appearance-root])";
        if (selector === `${host}:where(.dark)`) {
          return ':root[data-initial-theme="dark"], :where([data-po-appearance-root].dark)';
        }
        fail(`Fallback application CSS contains an unsupported selector: ${selector}.`);
      })
      .join(", ");
  });
  return [
    "/* This file is generated from sub-themes/default-neutral/theme.css. */",
    "/* It is the lowest cascade layer only; selected Sub Themes override it. */",
    root.toString().trim(),
    "",
  ].join("\n");
}

function normalizeNewlines(source) {
  return source.replace(/\r\n?/g, "\n");
}

function createBootstrap(definitions, fallback) {
  const firstPaintById = Object.fromEntries(definitions.flatMap((definition) => (
    definition.firstPaint === undefined ? [] : [[definition.id, definition.firstPaint]]
  )));
  const legacyPresetSubThemeIds = {};
  for (const definition of definitions) {
    for (const [mode, preset] of Object.entries(definition.legacyPresets ?? {})) {
      legacyPresetSubThemeIds[mode] ??= {};
      legacyPresetSubThemeIds[mode][preset] = definition.id;
    }
  }
  return {
    version: 1,
    fallbackSubThemeId: fallback.id,
    fallbackFirstPaint: fallback.firstPaint,
    firstPaintById,
    legacyPresetSubThemeIds,
  };
}

function renderTypeScriptBootstrap(definitions, fallback) {
  const value = createBootstrap(definitions, fallback);
  return [
    "/* This file is generated from built-in Sub Theme CSS packages. */",
    `export const SUB_THEME_BOOTSTRAP = Object.freeze(${JSON.stringify(value, null, 2)} as const);`,
    "export const FALLBACK_SUB_THEME_ID = SUB_THEME_BOOTSTRAP.fallbackSubThemeId;",
    "export const FALLBACK_SUB_THEME_FIRST_PAINT = SUB_THEME_BOOTSTRAP.fallbackFirstPaint;",
    "",
  ].join("\n");
}

function renderBrowserBootstrap(definitions, fallback) {
  return `/* This file is generated from built-in Sub Theme CSS packages. */\nwindow.__PUPPYONE_SUB_THEME_BOOTSTRAP__ = ${JSON.stringify(createBootstrap(definitions, fallback))};\n`;
}

function renderNativeBootstrap(definitions, fallback) {
  const value = createBootstrap(definitions, fallback);
  return [
    "/* This file is generated from built-in Sub Theme CSS packages. */",
    `export const FALLBACK_SUB_THEME_FIRST_PAINT = Object.freeze(${JSON.stringify(value.fallbackFirstPaint, null, 2)});`,
    "",
  ].join("\n");
}

function renderInitialShellCss(fallback) {
  return [
    "/* This file is generated from sub-themes/default-neutral/theme.css. */",
    ":root {",
    `  --initial-shell-background: ${fallback.firstPaint.light.background};`,
    "  --initial-shell-color-scheme: light;",
    "  background: var(--initial-shell-background);",
    "  color-scheme: var(--initial-shell-color-scheme);",
    "}",
    "",
    "html,",
    "body,",
    "#root {",
    "  width: 100%;",
    "  height: 100%;",
    "  margin: 0;",
    "}",
    "",
    "body,",
    "#root:empty {",
    "  overflow: hidden;",
    "  background: var(--initial-shell-background);",
    "}",
    "",
  ].join("\n");
}

function renderCompiledCssConstant(definition) {
  return `const ${getCompiledCssConstantName(definition.id)} = Object.freeze(${JSON.stringify(definition.compiledCss, null, 2)});`;
}

function getCompiledCssConstantName(id) {
  return `${id.replaceAll(/[^a-z0-9]+/gi, "_").toUpperCase()}_COMPILED_CSS`;
}

function quote(value) {
  return JSON.stringify(value);
}

function fail(message) {
  throw new TypeError(message);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
