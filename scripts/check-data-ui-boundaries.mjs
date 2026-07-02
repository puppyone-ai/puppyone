import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkedSrcDirs = [
  path.join(repoRoot, "packages", "data-ui", "src"),
  path.join(repoRoot, "packages", "editor-ui", "src"),
  path.join(repoRoot, "frontend", "shared-ui", "src"),
  path.join(repoRoot, "desktop", "vendor", "shared-ui", "src"),
];
const desktopSrcDirs = [
  path.join(repoRoot, "desktop", "src"),
];

const blockedImports = [
  { pattern: /^@\//, reason: "cloud frontend alias" },
  { pattern: /^next(\/|$)/, reason: "Next.js runtime" },
  { pattern: /^electron(\/|$)/, reason: "Electron runtime" },
  { pattern: /^@supabase\//, reason: "cloud auth/runtime" },
  { pattern: /^swr$/, reason: "cloud data fetching runtime" },
  { pattern: /frontend\//, reason: "cloud frontend source" },
  { pattern: /cloud-source\//, reason: "desktop cloud mirror" },
  { pattern: /^@tauri-apps\//, reason: "Tauri runtime" },
];
const blockedDesktopImports = [
  { pattern: /^@\//, reason: "cloud frontend alias" },
  { pattern: /^next(\/|$)/, reason: "Next.js runtime" },
  { pattern: /^@supabase\//, reason: "cloud auth/runtime" },
  { pattern: /^swr$/, reason: "cloud data fetching runtime" },
  { pattern: /frontend\//, reason: "cloud frontend source" },
  { pattern: /cloud-source\//, reason: "desktop cloud mirror" },
  {
    pattern: /^@puppyone\/(?:data-core|data-ui|editor-ui)$/,
    reason: "desktop must consume @puppyone/shared-ui",
  },
];

const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const sharedTreeSelectorPattern = /(^|[^A-Za-z0-9_-])\.(explorer-tree-shell|explorer-tree-root-scope|explorer-tree-scroll|explorer-tree-list|data-explorer-footer|tree-row|tree-row-content|tree-row-actions|tree-row-action-button|tree-icon-slot|tree-disclosure-marker|tree-label|tree-label-primary|tree-label-extension|tree-subtree-motion|tree-subtree-content|tree-meta-row|tree-status|tree-indent-guide)(?=[^A-Za-z0-9_-]|$)/g;
const errors = [
  ...findBoundaryErrors(checkedSrcDirs, blockedImports),
  ...findBoundaryErrors(desktopSrcDirs, blockedDesktopImports),
  ...findDesktopSharedTreeCssErrors([
    path.join(repoRoot, "desktop", "src", "styles.css"),
  ]),
];

if (errors.length > 0) {
  console.error("shared UI boundary check failed:");
  for (const error of errors) {
    if (error.kind === "css-selector") {
      console.error(
        `- ${path.relative(repoRoot, error.filePath)} defines "${error.specifier}" (${error.reason})`,
      );
    } else {
      console.error(
        `- ${path.relative(repoRoot, error.filePath)} imports "${error.specifier}" (${error.reason})`,
      );
    }
  }
  process.exit(1);
}

console.log("shared UI boundary check passed.");

function* walk(dirPath) {
  for (const entry of readdirSync(dirPath)) {
    const entryPath = path.join(dirPath, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      yield* walk(entryPath);
    } else if (stats.isFile()) {
      yield entryPath;
    }
  }
}

function findBoundaryErrors(srcDirs, blockedImportRules) {
  const boundaryErrors = [];

  for (const srcDir of srcDirs) {
    for (const filePath of walk(srcDir)) {
      if (!/\.(ts|tsx)$/.test(filePath)) continue;

      const source = readFileSync(filePath, "utf8");
      for (const specifier of collectSpecifiers(source)) {
        const blocked = blockedImportRules.find(({ pattern }) => pattern.test(specifier));
        if (!blocked) continue;

        boundaryErrors.push({
          filePath,
          specifier,
          reason: blocked.reason,
        });
      }
    }
  }

  return boundaryErrors;
}

function collectSpecifiers(source) {
  const specifiers = [];
  for (const pattern of [importPattern, dynamicImportPattern]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match) {
      specifiers.push(match[1]);
      match = pattern.exec(source);
    }
  }
  return specifiers;
}

function findDesktopSharedTreeCssErrors(cssFiles) {
  const boundaryErrors = [];

  for (const filePath of cssFiles) {
    const source = stripCssComments(readFileSync(filePath, "utf8"));
    for (const selector of collectSharedTreeSelectors(source)) {
      boundaryErrors.push({
        kind: "css-selector",
        filePath,
        specifier: selector,
        reason: "ExplorerTree component selectors belong in frontend/shared-ui/src/styles/data-workspace.css; desktop should override --po-tree-* variables instead",
      });
    }
  }

  return boundaryErrors;
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function collectSharedTreeSelectors(source) {
  const selectors = new Set();
  sharedTreeSelectorPattern.lastIndex = 0;

  let match = sharedTreeSelectorPattern.exec(source);
  while (match) {
    selectors.add(`.${match[2]}`);
    match = sharedTreeSelectorPattern.exec(source);
  }

  return [...selectors].sort();
}
