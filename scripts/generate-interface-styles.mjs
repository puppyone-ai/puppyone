#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(
  repoRoot,
  "src/features/appearance/interface-style-manifest.json",
);
const THEME_MODES = new Set(["system", "light", "dark"]);
const SUB_THEME_TARGETS = new Set(["application", "markdown", "csv"]);
const STYLE_COMPONENT_KEYS = [
  "shell",
  "titlebar",
  "navigation",
  "locationBar",
  "scrollbar",
  "iconPack",
];
const STYLE_POLICY_KEYS = [
  "themeMode",
  "sidebarNavigationLayout",
  "fileIconTheme",
];
const STYLE_PROFILE_KEYS = ["family", "variant", "palette"];
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUB_THEME_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const checkOnly = process.argv.includes("--check");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

validateManifest(manifest);
validateSkinContract(manifest);

const outputs = new Map([
  [
    path.join(repoRoot, "src/features/appearance/interfaceStyles.generated.ts"),
    renderTypeScriptManifest(manifest),
  ],
  [
    path.join(repoRoot, "public/interface-style-bootstrap.js"),
    renderBootstrapManifest(manifest),
  ],
  [
    path.join(repoRoot, "src/styles/interface-styles.generated.css"),
    renderStylesheetEntry(manifest),
  ],
]);

const staleOutputs = [];
for (const [outputPath, expected] of outputs) {
  if (checkOnly) {
    const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : null;
    if (current !== expected) staleOutputs.push(path.relative(repoRoot, outputPath));
    continue;
  }
  writeFileSync(outputPath, expected);
  console.log(`Generated ${path.relative(repoRoot, outputPath)}`);
}

if (staleOutputs.length > 0) {
  console.error("Interface style generated files are stale:");
  for (const output of staleOutputs) console.error(`- ${output}`);
  console.error("Run npm run generate:interface-styles and commit the results.");
  process.exit(1);
}

if (checkOnly) console.log("Interface style manifest and generated files are in sync.");

function validateManifest(value) {
  if (value?.version !== 4) fail("manifest version must be 4");
  if (!isNonEmptyString(value?.defaultStyle)) fail("defaultStyle must be a non-empty string");
  if (!isNonEmptyString(value?.fallbackSubThemeId) || !SUB_THEME_ID_PATTERN.test(value.fallbackSubThemeId)) {
    fail("fallbackSubThemeId must be a namespaced Sub Theme id");
  }
  if (!isNonEmptyString(value?.storage?.interfaceStyle)) fail("storage.interfaceStyle is required");
  if (!isNonEmptyString(value?.storage?.appearancePreferences)) fail("storage.appearancePreferences is required");
  if (!isNonEmptyString(value?.storage?.legacyAppearancePreferences)) fail("storage.legacyAppearancePreferences is required");
  if (!isNonEmptyString(value?.storage?.themeMode)) fail("storage.themeMode is required");
  if (!isNonEmptyString(value?.storage?.lightThemePreset)) fail("storage.lightThemePreset is required");
  if (!isNonEmptyString(value?.storage?.darkThemePreset)) fail("storage.darkThemePreset is required");
  if (!isNonEmptyString(value?.storage?.legacyThemePreset)) fail("storage.legacyThemePreset is required");
  if (!Array.isArray(value?.styles) || value.styles.length === 0) fail("styles must be a non-empty array");

  const ids = new Set();
  for (const style of value.styles) {
    if (!isNonEmptyString(style?.id) || !ID_PATTERN.test(style.id)) {
      fail(`invalid style id: ${String(style?.id)}`);
    }
    if (ids.has(style.id)) fail(`duplicate style id: ${style.id}`);
    ids.add(style.id);
    if (!isNonEmptyString(style.labelKey)) fail(`${style.id}.labelKey is required`);
    validateProfile(style);
    if (!isNonEmptyString(style.tokenSet) || !ID_PATTERN.test(style.tokenSet)) {
      fail(`${style.id}.tokenSet must be a stable kebab-case id`);
    }
    validateComposition(style);
    validatePolicies(style);

    const palette = style.palette;
    if (palette?.kind === "fixed") {
      if (palette.mode !== "light" && palette.mode !== "dark") {
        fail(`${style.id}.palette.mode must be light or dark`);
      }
      validateFirstPaint(style, [palette.mode]);
    } else if (palette?.kind === "adaptive") {
      if (!Array.isArray(palette.modes) || palette.modes.length === 0) {
        fail(`${style.id}.palette.modes must be non-empty`);
      }
      const modes = new Set(palette.modes);
      if (modes.size !== palette.modes.length) fail(`${style.id}.palette.modes contains duplicates`);
      for (const mode of modes) {
        if (!THEME_MODES.has(mode)) fail(`${style.id}.palette.modes contains ${String(mode)}`);
      }
      if (!modes.has(palette.fallbackMode)) {
        fail(`${style.id}.palette.fallbackMode must be one of its modes`);
      }
      if (typeof palette.presetControls?.light !== "boolean" || typeof palette.presetControls?.dark !== "boolean") {
        fail(`${style.id}.palette.presetControls must declare light and dark booleans`);
      }
      if (style.firstPaint !== undefined) {
        fail(`${style.id}.firstPaint belongs to its Sub Theme unless the Root Theme is fixed`);
      }
      if (style.presetFirstPaint !== undefined) {
        fail(`${style.id}.presetFirstPaint is forbidden; first paint is compiled from Sub Theme CSS`);
      }
    } else {
      fail(`${style.id}.palette.kind must be adaptive or fixed`);
    }
    validateSubThemes(style);

    if (style.stylesheet !== null) {
      if (!isNonEmptyString(style.stylesheet) || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*\.css$/.test(style.stylesheet)) {
        fail(`${style.id}.stylesheet must be null or a relative kebab-case CSS path`);
      }
      const stylesheetPath = path.join(repoRoot, "src/styles", style.stylesheet);
      if (!existsSync(stylesheetPath)) fail(`${style.id}.stylesheet does not exist: ${style.stylesheet}`);
    }
  }

  if (!ids.has(value.defaultStyle)) fail("defaultStyle must reference a registered style");
  const defaultStyle = value.styles.find((style) => style.id === value.defaultStyle);
  if (defaultStyle?.stylesheet !== null) fail("The Default style must be a no-op baseline with stylesheet: null");
}

function validateSubThemes(style) {
  const definition = style.subThemes;
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    fail(`${style.id}.subThemes is required`);
  }
  if (
    !definition.defaultSubThemeIds
    || typeof definition.defaultSubThemeIds !== "object"
    || Array.isArray(definition.defaultSubThemeIds)
  ) {
    fail(`${style.id}.subThemes.defaultSubThemeIds is required`);
  }
  const requiredModes = style.palette.kind === "fixed"
    ? [style.palette.mode]
    : style.palette.modes.includes("system")
      ? ["light", "dark"]
      : style.palette.modes;
  const defaultModes = Object.keys(definition.defaultSubThemeIds);
  if (
    defaultModes.length !== requiredModes.length
    || requiredModes.some((mode) => !defaultModes.includes(mode))
    || defaultModes.some((mode) => !requiredModes.includes(mode))
  ) {
    fail(`${style.id}.subThemes.defaultSubThemeIds must match its effective Color Modes`);
  }
  for (const mode of requiredModes) {
    const id = definition.defaultSubThemeIds[mode];
    if (!isNonEmptyString(id) || !SUB_THEME_ID_PATTERN.test(id)) {
      fail(`${style.id}.subThemes.defaultSubThemeIds.${mode} must be a namespaced id`);
    }
  }
  if (
    !Array.isArray(definition.allowedTargets)
    || definition.allowedTargets.length === 0
    || definition.allowedTargets.some((target) => !SUB_THEME_TARGETS.has(target))
    || new Set(definition.allowedTargets).size !== definition.allowedTargets.length
  ) {
    fail(`${style.id}.subThemes.allowedTargets must contain unique supported targets`);
  }
}

function validateProfile(style) {
  if (!style.profile || typeof style.profile !== "object" || Array.isArray(style.profile)) {
    fail(`${style.id}.profile is required`);
  }
  const unknown = Object.keys(style.profile).filter((key) => !STYLE_PROFILE_KEYS.includes(key));
  if (unknown.length > 0) fail(`${style.id}.profile has unknown fields: ${unknown.join(", ")}`);
  for (const key of STYLE_PROFILE_KEYS) {
    const value = style.profile[key];
    if (!isNonEmptyString(value) || !ID_PATTERN.test(value)) {
      fail(`${style.id}.profile.${key} must be a stable kebab-case id`);
    }
  }
}

function validateComposition(style) {
  if (!style.composition || typeof style.composition !== "object" || Array.isArray(style.composition)) {
    fail(`${style.id}.composition is required`);
  }
  const unknown = Object.keys(style.composition).filter((key) => !STYLE_COMPONENT_KEYS.includes(key));
  if (unknown.length > 0) fail(`${style.id}.composition has unknown fields: ${unknown.join(", ")}`);
  for (const key of STYLE_COMPONENT_KEYS) {
    const value = style.composition[key];
    if (!isNonEmptyString(value) || !ID_PATTERN.test(value)) {
      fail(`${style.id}.composition.${key} must be a stable kebab-case id`);
    }
  }
}

function validatePolicies(style) {
  if (!style.policies || typeof style.policies !== "object" || Array.isArray(style.policies)) {
    fail(`${style.id}.policies is required`);
  }
  const unknown = Object.keys(style.policies).filter((key) => !STYLE_POLICY_KEYS.includes(key));
  if (unknown.length > 0) fail(`${style.id}.policies has unknown fields: ${unknown.join(", ")}`);
  for (const key of STYLE_POLICY_KEYS) {
    const policy = style.policies[key];
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      fail(`${style.id}.policies.${key} is required`);
    }
    if (policy.mode === "inherit") {
      if (Object.keys(policy).some((field) => field !== "mode")) {
        fail(`${style.id}.policies.${key} inherit policy cannot declare extra fields`);
      }
      continue;
    }
    if (policy.mode === "force") {
      if (!isNonEmptyString(policy.value) || !isNonEmptyString(policy.reasonKey)) {
        fail(`${style.id}.policies.${key} force policy requires value and reasonKey`);
      }
      continue;
    }
    if (policy.mode === "allow") {
      if (!Array.isArray(policy.values) || policy.values.length === 0 || policy.values.some((value) => !isNonEmptyString(value))) {
        fail(`${style.id}.policies.${key} allow policy requires string values`);
      }
      if (policy.default !== undefined && !policy.values.includes(policy.default)) {
        fail(`${style.id}.policies.${key} default must be allowed`);
      }
      continue;
    }
    if (policy.mode === "unavailable") {
      if (!isNonEmptyString(policy.reasonKey)) {
        fail(`${style.id}.policies.${key} unavailable policy requires reasonKey`);
      }
      continue;
    }
    fail(`${style.id}.policies.${key} has unsupported mode ${String(policy.mode)}`);
  }
}

function validateFirstPaint(style, requiredModes) {
  for (const mode of requiredModes) {
    if (mode === "system") continue;
    const paint = style.firstPaint?.[mode];
    if (!isNonEmptyString(paint?.background)) fail(`${style.id}.firstPaint.${mode}.background is required`);
    if (paint?.colorScheme !== mode) fail(`${style.id}.firstPaint.${mode}.colorScheme must be ${mode}`);
  }
}

function validateSkinContract(value) {
  const contractPath = path.join(repoRoot, "src/styles/interface-skin-contract.css");
  const contractSource = readFileSync(contractPath, "utf8");
  const requiredTokens = new Set(
    [...contractSource.matchAll(/var\((--interface-[a-z0-9-]+)/g)].map((match) => match[1]),
  );
  if (requiredTokens.size === 0) fail("interface-skin-contract.css does not expose any interface tokens");

  for (const style of value.styles) {
    if (style.stylesheet === null) continue;
    const stylesheetPath = path.join(repoRoot, "src/styles", style.stylesheet);
    const source = readStylePackSource(stylesheetPath);
    if (!source.includes(`:root[data-interface-style="${style.id}"]`)) {
      fail(`${style.stylesheet} does not scope itself to ${style.id}`);
    }
    const missingTokens = [...requiredTokens].filter((token) => !source.includes(`${token}:`));
    if (missingTokens.length > 0) {
      fail(`${style.stylesheet} is missing contract tokens: ${missingTokens.join(", ")}`);
    }
  }
}

function readStylePackSource(stylesheetPath, visited = new Set()) {
  const resolvedPath = path.resolve(stylesheetPath);
  const stylesRoot = path.resolve(repoRoot, "src/styles");
  if (resolvedPath !== stylesRoot && !resolvedPath.startsWith(`${stylesRoot}${path.sep}`)) {
    fail(`style import escapes src/styles: ${stylesheetPath}`);
  }
  if (visited.has(resolvedPath)) fail(`circular style import: ${path.relative(repoRoot, resolvedPath)}`);
  visited.add(resolvedPath);
  const source = readFileSync(resolvedPath, "utf8");
  const imported = [...source.matchAll(/@import\s+["']([^"']+)["']\s*;/g)].map((match) => {
    const importedPath = path.resolve(path.dirname(resolvedPath), match[1]);
    if (!existsSync(importedPath)) fail(`style import does not exist: ${match[1]}`);
    return readStylePackSource(importedPath, visited);
  });
  visited.delete(resolvedPath);
  return [source, ...imported].join("\n");
}

function renderTypeScriptManifest(value) {
  return `/* This file is generated by scripts/generate-interface-styles.mjs. */\n\nexport const INTERFACE_STYLE_MANIFEST = ${JSON.stringify(value, null, 2)} as const;\n`;
}

function renderBootstrapManifest(value) {
  return `/* This file is generated by scripts/generate-interface-styles.mjs. */\nwindow.__PUPPYONE_INTERFACE_STYLE_MANIFEST__ = ${JSON.stringify(value)};\n`;
}

function renderStylesheetEntry(value) {
  const imports = ["interface-skin-contract.css", ...value.styles.flatMap((style) => (
    style.stylesheet ? [style.stylesheet] : []
  ))];
  return [
    "/* This file is generated by scripts/generate-interface-styles.mjs. */",
    ...imports.map((stylesheet) => `@import "./${stylesheet}" layer(interface-style);`),
    "",
  ].join("\n");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function fail(message) {
  throw new Error(`Invalid interface style manifest: ${message}`);
}
