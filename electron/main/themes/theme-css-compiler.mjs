import postcss from "postcss";
import path from "node:path";
import { THEME_TARGETS } from "./theme-package-contract.mjs";

const targetSet = new Set(THEME_TARGETS);
const themeIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){2,}$/;
const reservedBuiltinThemeIdPattern = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const allowedContainerAtRules = new Set(["media", "supports"]);
const allowedDataUrlPattern = /^data:(?:image\/(?:png|jpeg|gif|webp|svg\+xml)|font\/(?:woff2?|ttf|otf));/i;
const rootAliases = [".theme-root", ":root", "html", "body", "#write"];
const applicationColorTokens = new Set([
  "--po-surface-canvas",
  "--po-surface-chrome",
  "--po-surface-panel",
  "--po-surface-panel-raised",
  "--po-surface-overlay",
  "--po-surface-inset",
  "--po-surface-editor",
  "--po-surface-terminal",
  "--po-canvas",
  "--po-chrome",
  "--po-panel",
  "--po-panel-raised",
  "--po-overlay",
  "--po-inset",
  "--po-header",
  "--po-sidebar",
  "--po-control",
  "--po-control-hover",
  "--po-text",
  "--po-text-muted",
  "--po-text-subtle",
  "--po-text-disabled",
  "--po-text-inverse",
  "--po-border",
  "--po-border-strong",
  "--po-border-subtle",
  "--po-divider",
  "--po-shell-divider",
  "--po-header-divider",
  "--po-sidebar-divider",
  "--po-hover",
  "--po-selected",
  "--po-active",
  "--po-accent",
  "--po-accent-text",
  "--po-focus-ring",
  "--po-danger",
  "--po-info",
  "--po-success",
  "--po-success-contrast",
  "--po-warning",
  "--po-notification",
  "--po-notification-text",
  "--po-backdrop",
  "--po-backdrop-strong",
  "--po-shadow",
  "--po-text-fill-hover",
  "--po-skeleton-base",
  "--po-skeleton-shimmer",
  "--po-skeleton-edge",
  "--po-switch-border-on",
  "--po-switch-border-off",
  "--po-switch-thumb",
  "--po-switch-thumb-shadow",
  "--po-access-active-bg",
  "--po-access-active-hover",
  "--po-access-active-border",
  "--po-access-active-text",
  "--po-purple",
  "--po-project-card-tab",
  "--po-project-card-hover-bg",
  "--po-filetree-rail",
  "--po-tree-guide",
  "--po-file-icon-body",
  "--po-file-icon-fold",
  "--po-file-icon-stroke",
  "--po-file-icon-shadow",
  "--po-file-accent-default",
  "--po-file-accent-markdown",
  "--po-file-accent-json",
  "--po-file-accent-html",
  "--po-file-accent-pdf",
  "--po-file-accent-image",
  "--po-file-accent-audio",
  "--po-file-accent-video",
  "--po-file-accent-code",
  "--po-file-accent-word",
  "--po-file-accent-sheet",
  "--po-file-accent-presentation",
  "--po-diff-added-bg",
  "--po-diff-added-text",
  "--po-diff-removed-bg",
  "--po-diff-removed-text",
  "--po-editor-line",
  "--po-json-key",
  "--po-json-string",
  "--po-json-number",
  "--po-json-boolean",
  "--po-json-null",
  "--po-json-icon",
  "--po-scrollbar-thumb",
  "--po-scrollbar-thumb-hover",
  "--po-cloud-titlebar-bg",
  "--po-cloud-titlebar-text",
  "--po-cloud-titlebar-text-muted",
  "--po-cloud-titlebar-text-disabled",
  "--po-cloud-titlebar-hover",
  "--po-cloud-titlebar-active",
  "--po-cloud-titlebar-focus",
  "--po-terminal-cursor",
  "--po-terminal-selection",
  "--po-terminal-black",
  "--po-terminal-red",
  "--po-terminal-green",
  "--po-terminal-yellow",
  "--po-terminal-blue",
  "--po-terminal-magenta",
  "--po-terminal-cyan",
  "--po-terminal-white",
  "--po-terminal-bright-black",
  "--po-terminal-bright-red",
  "--po-terminal-bright-green",
  "--po-terminal-bright-yellow",
  "--po-terminal-bright-blue",
  "--po-terminal-bright-magenta",
  "--po-terminal-bright-cyan",
  "--po-terminal-bright-white",
]);
const typographyTokenMap = new Map([
  ["--po-text-size-interface", Object.freeze({ host: "--po-theme-text-size-interface", min: 11, max: 18 })],
  ["--po-text-size-content", Object.freeze({ host: "--po-theme-text-size-content", min: 12, max: 24 })],
  ["--po-text-size-conversation", Object.freeze({ host: "--po-theme-text-size-conversation", min: 12, max: 20 })],
  ["--po-text-size-data", Object.freeze({ host: "--po-theme-text-size-data", min: 10, max: 18 })],
  ["--po-code-font-size", Object.freeze({ host: "--po-theme-code-font-size", min: 10, max: 20 })],
  ["--po-terminal-font-size", Object.freeze({ host: "--po-theme-terminal-font-size", min: 10, max: 20 })],
]);
const markdownTokenMap = new Map([
  ["--po-md-surface-background", "--po-host-md-surface-background"],
  ["--po-md-content-color", "--po-host-md-content-color"],
  ["--po-md-content-font", "--po-host-md-content-font"],
  ["--po-md-content-size", "--po-host-md-content-size"],
  ["--po-md-content-weight", "--po-host-md-content-weight"],
  ["--po-md-content-letter-spacing", "--po-host-md-content-letter-spacing"],
  ["--po-md-content-line-height", "--po-host-md-content-line-height"],
  ["--po-md-block-gap", "--po-host-md-block-gap"],
  ["--po-md-heading-gap-before", "--po-host-md-heading-gap-before"],
  ["--po-md-heading-gap-after", "--po-host-md-heading-gap-after"],
  ["--po-md-heading-color", "--po-host-md-heading-color"],
  ["--po-md-heading-weight", "--po-host-md-heading-weight"],
  ["--po-md-heading-line-height", "--po-host-md-heading-line-height"],
  ["--po-md-heading-border-color", "--po-host-md-heading-border-color"],
  ["--po-md-h1-size", "--po-host-md-h1-size"],
  ["--po-md-h2-size", "--po-host-md-h2-size"],
  ["--po-md-h3-size", "--po-host-md-h3-size"],
  ["--po-md-h4-size", "--po-host-md-h4-size"],
  ["--po-md-h5-size", "--po-host-md-h5-size"],
  ["--po-md-h6-size", "--po-host-md-h6-size"],
  ["--po-md-h1-weight", "--po-host-md-h1-weight"],
  ["--po-md-h2-weight", "--po-host-md-h2-weight"],
  ["--po-md-h3-weight", "--po-host-md-h3-weight"],
  ["--po-md-strong-weight", "--po-host-md-strong-weight"],
  ["--po-md-strong-color", "--po-host-md-strong-color"],
  ["--po-md-rule-color", "--po-host-md-rule-color"],
  ["--po-md-link-color", "--po-host-md-link-color"],
  ["--po-md-blockquote-color", "--po-host-md-blockquote-color"],
  ["--po-md-blockquote-border-color", "--po-host-md-blockquote-border-color"],
  ["--po-md-inline-code-background", "--po-host-md-inline-code-background"],
  ["--po-md-inline-code-color", "--po-host-md-inline-code-color"],
  ["--po-md-code-block-background", "--po-host-md-code-block-background"],
  ["--po-md-code-block-color", "--po-host-md-code-block-color"],
  ["--po-md-syntax-keyword", "--po-host-md-syntax-keyword"],
  ["--po-md-syntax-string", "--po-host-md-syntax-string"],
  ["--po-md-syntax-comment", "--po-host-md-syntax-comment"],
  ["--po-md-syntax-constant", "--po-host-md-syntax-constant"],
  ["--po-md-syntax-special", "--po-host-md-syntax-special"],
  ["--po-md-syntax-type", "--po-host-md-syntax-type"],
  ["--po-md-syntax-function", "--po-host-md-syntax-function"],
  ["--po-md-syntax-property", "--po-host-md-syntax-property"],
  ["--po-md-syntax-operator", "--po-host-md-syntax-operator"],
  ["--po-md-syntax-meta", "--po-host-md-syntax-meta"],
]);
const markdownIntegerSizeTokens = new Set([
  "--po-md-content-size",
  "--po-md-h1-size",
  "--po-md-h2-size",
  "--po-md-h3-size",
  "--po-md-h4-size",
  "--po-md-h5-size",
  "--po-md-h6-size",
]);
const csvTokenMap = new Map([
  ["--po-csv-surface-background", "--po-host-csv-surface-background"],
  ["--po-csv-surface-color", "--po-host-csv-surface-color"],
  ["--po-editable-table-background", "--po-host-csv-table-background"],
  ["--po-editable-table-border", "--po-host-csv-table-border"],
  ["--po-editable-table-cell-border", "--po-host-csv-cell-border"],
  ["--po-editable-table-header-background", "--po-host-csv-header-background"],
  ["--po-editable-table-sticky-header-background", "--po-host-csv-header-background"],
  ["--csv-table-record-index-background", "--po-host-csv-index-background"],
  ["--po-editable-table-cell-hover-background", "--po-host-csv-cell-hover-background"],
  ["--po-editable-table-cell-focus-background", "--po-host-csv-cell-focus-background"],
  ["--po-editable-table-cell-focus-ring", "--po-host-csv-cell-focus-ring"],
]);

export async function compileThemeCss({
  css,
  themeId,
  target,
  supportedModes,
  sourcePath = "theme.css",
  loadImport,
  resolveAssetUrl,
  allowReservedBuiltinId = false,
}) {
  if (typeof css !== "string") throw new TypeError("Theme CSS must be a string.");
  if (
    !themeIdPattern.test(themeId)
    && !(allowReservedBuiltinId && reservedBuiltinThemeIdPattern.test(themeId))
  ) {
    throw new TypeError("Theme id is invalid.");
  }
  if (!targetSet.has(target)) throw new TypeError(`Unsupported theme target: ${String(target)}.`);

  const root = await parseAndInlineImports(css, {
    sourcePath,
    loadImport,
    ancestry: [sourcePath],
    depth: 0,
  });
  root.walkAtRules("charset", (rule) => rule.remove());
  validateAtRules(root);
  validateModeContract(root, supportedModes, target);
  validateApplicationModeIsolation(root, { target, supportedModes });
  const firstPaint = extractFirstPaint(root, { target, supportedModes });
  scopeRules(root, { themeId, target });
  await rewriteAssetUrls(root, resolveAssetUrl);
  validateDeclarations(root, { target });

  return Object.freeze({
    css: root.toString().trim(),
    ...(firstPaint === undefined ? {} : { firstPaint }),
    target,
    themeId,
  });
}

function extractFirstPaint(root, { target, supportedModes }) {
  if (target !== "application") return undefined;
  const modes = new Set(supportedModes ?? ["light", "dark"]);
  const backgrounds = {};
  root.walkRules((rule) => {
    const selectors = splitSelectors(rule.selector);
    const dark = selectors.some((selector) => hasDarkSelector(selector));
    const light = selectors.some((selector) => !hasDarkSelector(selector));
    rule.nodes.forEach((node) => {
      if (node.type !== "decl" || node.prop.toLowerCase() !== "--po-canvas") return;
      const background = normalizeOpaqueColor(node.value);
      if (!background) return;
      if (light && modes.has("light")) backgrounds.light = background;
      if (dark && modes.has("dark")) backgrounds.dark = background;
    });
  });
  const firstPaint = Object.fromEntries(
    [...modes]
      .filter((mode) => backgrounds[mode] !== undefined)
      .map((mode) => [mode, Object.freeze({
        background: backgrounds[mode],
        colorScheme: mode,
      })]),
  );
  return Object.keys(firstPaint).length === 0 ? undefined : Object.freeze(firstPaint);
}

function normalizeOpaqueColor(value) {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized;
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${[...normalized.slice(1)].map((character) => character.repeat(2)).join("")}`;
  }
  return null;
}

function validateModeContract(root, supportedModes, target) {
  const modes = supportedModes === undefined ? null : new Set(supportedModes);
  if (modes && (modes.size === 0 || [...modes].some((mode) => mode !== "light" && mode !== "dark"))) {
    throw new TypeError("Theme CSS received an invalid supported Color Mode contract.");
  }
  root.walkAtRules("media", (rule) => {
    if (/prefers-color-scheme/i.test(rule.params)) {
      throw new TypeError("Sub Themes must use their declared light/dark variants, not prefers-color-scheme.");
    }
  });
  if (!modes) return;
  const containsDarkSelector = [...collectRules(root)].some((rule) => (
    rule.selector.split(",").some((selector) => hasDarkSelector(selector))
  ));
  const containsDeclarations = [...collectDeclarations(root)].length > 0;
  if (
    target !== "typography"
    && modes.has("light")
    && modes.has("dark")
    && containsDeclarations
    && !containsDarkSelector
  ) {
    throw new TypeError("A dual-mode Sub Theme target must declare explicit dark root tokens.");
  }
  if (modes.has("dark")) return;
  root.walkRules((rule) => {
    if (rule.selector.split(",").some((selector) => hasDarkSelector(selector))) {
      throw new TypeError("A light-only Sub Theme cannot declare dark selectors.");
    }
  });
}

function validateApplicationModeIsolation(root, { target, supportedModes }) {
  if (target !== "application") return;
  const modes = new Set(supportedModes ?? []);
  if (!modes.has("light") || !modes.has("dark")) return;

  const sharedStaticTokens = new Set();
  const darkTokens = new Set();
  root.walkRules((rule) => {
    const selectors = splitSelectors(rule.selector);
    const hasSharedSelector = selectors.some((selector) => !hasDarkSelector(selector));
    const hasDarkVariantSelector = selectors.some((selector) => hasDarkSelector(selector));
    for (const node of rule.nodes) {
      if (node.type !== "decl") continue;
      const property = node.prop.toLowerCase();
      if (!applicationColorTokens.has(property)) continue;
      if (hasDarkVariantSelector) darkTokens.add(property);
      if (hasSharedSelector && !isModeAdaptiveTokenValue(node.value)) {
        sharedStaticTokens.add(property);
      }
    }
  });

  const leakingTokens = [...sharedStaticTokens]
    .filter((property) => !darkTokens.has(property))
    .sort();
  if (leakingTokens.length > 0) {
    throw new TypeError(
      `A dual-mode Application Sub Theme must override static color tokens in its dark variant: ${leakingTokens.join(", ")}.`,
    );
  }
}

function isModeAdaptiveTokenValue(value) {
  return /(?:^|[^a-z-])var\s*\(/i.test(value) || /(?:^|[^a-z-])light-dark\s*\(/i.test(value);
}

function collectRules(root) {
  const rules = [];
  root.walkRules((rule) => rules.push(rule));
  return rules;
}

function collectDeclarations(root) {
  const declarations = [];
  root.walkDecls((declaration) => declarations.push(declaration));
  return declarations;
}

function hasDarkSelector(selector) {
  return /(?:^|[^a-z0-9_-])\.dark(?:[^a-z0-9_-]|$)/i.test(selector);
}

async function parseAndInlineImports(css, { sourcePath, loadImport, ancestry, depth }) {
  if (depth > 8) throw new TypeError("Theme CSS import depth exceeds the supported limit.");
  let root;
  try {
    root = postcss.parse(css, { from: sourcePath });
  } catch (error) {
    throw new TypeError(`Theme CSS could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const imports = [];
  root.walkAtRules("import", (rule) => imports.push(rule));
  for (const rule of imports) {
    const specifier = parseImportSpecifier(rule.params);
    if (!specifier || !isSafeRelativePath(specifier) || !specifier.toLowerCase().endsWith(".css")) {
      throw new TypeError("Theme CSS imports must reference a package-local CSS file.");
    }
    if (typeof loadImport !== "function") {
      throw new TypeError(`Theme CSS import cannot be loaded: ${specifier}.`);
    }
    const imported = await loadImport(specifier, sourcePath);
    const importedCss = typeof imported === "string" ? imported : imported?.css;
    const importedSourcePath = typeof imported === "string" ? specifier : imported?.sourcePath;
    if (typeof importedCss !== "string" || typeof importedSourcePath !== "string") {
      throw new TypeError(`Theme CSS import did not return text: ${specifier}.`);
    }
    if (ancestry.includes(importedSourcePath)) {
      throw new TypeError(`Theme CSS import cycle detected at ${importedSourcePath}.`);
    }
    const importedRoot = await parseAndInlineImports(importedCss, {
      sourcePath: importedSourcePath,
      loadImport,
      ancestry: [...ancestry, importedSourcePath],
      depth: depth + 1,
    });
    rule.replaceWith(...importedRoot.nodes.map((node) => node.clone()));
  }
  return root;
}

function validateAtRules(root) {
  root.walkAtRules((rule) => {
    const name = rule.name.toLowerCase();
    if (allowedContainerAtRules.has(name)) return;
    throw new TypeError(`Unsupported theme CSS at-rule: @${rule.name}.`);
  });
}

function scopeRules(root, { themeId, target }) {
  const host = `[data-po-appearance-root][data-sub-theme-id="${themeId}"]`;
  root.walkRules((rule) => {
    const selectors = splitSelectors(rule.selector);
    const scoped = selectors.map((selector) => scopeSelector(selector, host, target));
    const rootOnly = selectors.every((selector) => isApplicationRootSelector(selector));
    if (!rootOnly) {
      throw new TypeError(`${target} Sub Themes may only declare root-level public tokens.`);
    }
    rule.selector = scoped.join(", ");
  });
}

function scopeSelector(selector, host, target) {
  const normalized = selector.trim();
  if (!normalized) throw new TypeError("Theme CSS contains an empty selector.");
  if (normalized.includes(":global(") || normalized.includes(":host") || normalized.includes("::part")) {
    throw new TypeError(`Theme CSS selector can escape its surface: ${normalized}.`);
  }

  const darkRoot = parseDarkRootSelector(normalized);
  if (darkRoot) {
    assertRootSuffixRemainsScoped(darkRoot.suffix, normalized);
    if (darkRoot.suffix.length === 0) return `${host}:where(.dark)`;
    return `:where(.dark) ${host}${darkRoot.suffix}`;
  }

  const alias = rootAliases.find((candidate) => startsWithSelectorToken(normalized, candidate));
  if (!alias) {
    if (containsRootAlias(normalized)) {
      throw new TypeError(`Theme CSS root aliases must start the selector: ${normalized}.`);
    }
    assertRootSuffixRemainsScoped(` ${normalized}`, normalized);
    return `${host} ${normalized}`;
  }

  const suffix = normalized.slice(alias.length);
  if (containsRootAlias(suffix)) {
    throw new TypeError(`Theme CSS selector contains more than one root alias: ${normalized}.`);
  }
  if (suffix === ".dark") {
    return `${host}:where(.dark)`;
  }
  assertRootSuffixRemainsScoped(suffix, normalized);
  return `${host}${suffix}`;
}

function assertRootSuffixRemainsScoped(suffix, selector) {
  let depth = 0;
  let quote = null;
  for (let index = 0; index < suffix.length; index += 1) {
    const character = suffix[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "/" && suffix[index + 1] === "*") {
      const end = suffix.indexOf("*/", index + 2);
      index = end < 0 ? suffix.length : end + 1;
      continue;
    }
    if (character === "(" || character === "[") {
      depth += 1;
      continue;
    }
    if (character === ")" || character === "]") {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    if (/\s/.test(character)) {
      let next = index + 1;
      while (next < suffix.length) {
        if (/\s/.test(suffix[next])) {
          next += 1;
        } else if (suffix[next] === "/" && suffix[next + 1] === "*") {
          const end = suffix.indexOf("*/", next + 2);
          next = end < 0 ? suffix.length : end + 2;
        } else {
          break;
        }
      }
      if (suffix[next] === "+" || suffix[next] === "~" || suffix.slice(next, next + 2) === "||") {
        throw new TypeError(`Theme CSS selector can escape its surface: ${selector}.`);
      }
      return;
    }
    if (character === "+" || character === "~" || suffix.slice(index, index + 2) === "||") {
      throw new TypeError(`Theme CSS selector can escape its surface: ${selector}.`);
    }
    if (character === ">") return;
  }
}

async function rewriteAssetUrls(root, resolveAssetUrl) {
  const declarations = [];
  root.walkDecls((declaration) => declarations.push(declaration));
  for (const declaration of declarations) {
    declaration.value = await replaceUrls(declaration.value, async (specifier) => {
      if (specifier.startsWith("data:")) {
        if (!allowedDataUrlPattern.test(specifier) || specifier.length > 512_000) {
          throw new TypeError("Theme CSS data URLs must be bounded image or font assets.");
        }
        return specifier;
      }
      if (!isSafeRelativePath(specifier)) {
        throw new TypeError(`Theme CSS cannot load external asset URL: ${specifier}.`);
      }
      if (typeof resolveAssetUrl !== "function") {
        throw new TypeError(`Theme CSS asset cannot be resolved: ${specifier}.`);
      }
      const resolved = await resolveAssetUrl(
        specifier,
        normalizeSourcePath(declaration.source?.input?.file ?? "theme.css"),
      );
      if (typeof resolved !== "string" || !allowedDataUrlPattern.test(resolved)) {
        throw new TypeError(`Theme CSS asset resolver returned an unsupported URL for ${specifier}.`);
      }
      return resolved;
    });
  }
}

function normalizeSourcePath(value) {
  const normalized = path.isAbsolute(value) ? path.relative(process.cwd(), value) : value;
  return normalized.split(path.sep).join("/");
}

function validateDeclarations(root, { target }) {
  root.walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase();
    const value = declaration.value.trim().toLowerCase();
    if (declaration.important) {
      throw new TypeError("Theme CSS cannot use !important; cascade precedence is managed by PuppyOne.");
    }
    if (target === "application" && !applicationColorTokens.has(property)) {
      throw new TypeError("Application Sub Themes may only declare public color tokens.");
    }
    if (target === "typography") {
      const contract = typographyTokenMap.get(property);
      if (!contract) {
        throw new TypeError("Typography Sub Themes may only declare public typography size tokens.");
      }
      const size = parseIntegerPixelSize(value);
      if (size === null || size < contract.min || size > contract.max) {
        throw new TypeError(
          `Typography token ${property} must be a plain pixel value between ${contract.min}px and ${contract.max}px.`,
        );
      }
      declaration.prop = contract.host;
    }
    if (target === "markdown") {
      const mapped = markdownTokenMap.get(property);
      if (!mapped) throw new TypeError("Markdown Sub Themes may only declare public Markdown tokens.");
      if (markdownIntegerSizeTokens.has(property) && parseIntegerPixelSize(value) === null) {
        throw new TypeError(`Markdown size token ${property} must be a plain integer pixel value.`);
      }
      declaration.prop = mapped;
    }
    if (target === "csv") {
      const mapped = csvTokenMap.get(property);
      if (!mapped) throw new TypeError("CSV Sub Themes may only declare public CSV tokens.");
      declaration.prop = mapped;
    }
    if (property === "position" && value === "fixed") {
      throw new TypeError("Theme CSS cannot use fixed positioning.");
    }
    if (value.includes("expression(") || value.includes("-moz-binding")) {
      throw new TypeError("Theme CSS contains an unsupported executable value.");
    }
  });
}

function parseIntegerPixelSize(value) {
  const match = value.match(/^(\d+)px$/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseImportSpecifier(params) {
  const value = params.trim();
  const quoted = value.match(/^(?:"([^"]+)"|'([^']+)')$/);
  if (quoted) return quoted[1] ?? quoted[2];
  const url = value.match(/^url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s"')]+))\s*\)$/i);
  return url ? url[1] ?? url[2] ?? url[3] : null;
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240) return false;
  if (value.includes("\\") || value.startsWith("/") || value.startsWith("~")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  const normalized = value.startsWith("./") ? value.slice(2) : value;
  const segments = normalized.split("/");
  return segments.every((segment) => segment.length > 0);
}

function startsWithSelectorToken(selector, token) {
  if (!selector.startsWith(token)) return false;
  const next = selector[token.length];
  return next === undefined || /[\s>+~:.#[\]]/.test(next);
}

function containsRootAlias(selector) {
  return rootAliases.some((alias) => {
    const index = selector.indexOf(alias);
    if (index < 0) return false;
    const previous = selector[index - 1];
    const next = selector[index + alias.length];
    const leftBoundary = previous === undefined || /[\s>+~,(]/.test(previous);
    const rightBoundary = next === undefined || /[\s>+~:.#[\],)]/.test(next);
    return leftBoundary && rightBoundary;
  });
}

function isRootOnlySelector(selector) {
  const normalized = selector.trim();
  return rootAliases.some((alias) => normalized === alias);
}

function isApplicationRootSelector(selector) {
  const normalized = selector.trim();
  if (isRootOnlySelector(normalized)) return true;
  if (rootAliases.some((alias) => normalized === `${alias}.dark`)) return true;
  const darkRoot = parseDarkRootSelector(normalized);
  return Boolean(darkRoot && darkRoot.suffix.length === 0);
}

function parseDarkRootSelector(selector) {
  if (!selector.startsWith(".dark ")) return null;
  const nested = selector.slice(".dark ".length).trimStart();
  const alias = rootAliases.find((candidate) => startsWithSelectorToken(nested, candidate));
  if (!alias) return null;
  const suffix = nested.slice(alias.length);
  if (containsRootAlias(suffix)) {
    throw new TypeError(`Theme CSS selector contains more than one root alias: ${selector}.`);
  }
  return { suffix };
}

function splitSelectors(value) {
  const selectors = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[") depth += 1;
    else if (character === ")" || character === "]") depth -= 1;
    else if (character === "," && depth === 0) {
      selectors.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(value.slice(start).trim());
  return selectors;
}

async function replaceUrls(value, replace) {
  const pattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
  const matches = [...value.matchAll(pattern)];
  if (matches.length === 0) return value;
  let result = "";
  let offset = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    const specifier = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    const resolved = await replace(specifier);
    result += value.slice(offset, index);
    result += `url("${resolved.replaceAll('"', "\\\"")}")`;
    offset = index + match[0].length;
  }
  return result + value.slice(offset);
}
