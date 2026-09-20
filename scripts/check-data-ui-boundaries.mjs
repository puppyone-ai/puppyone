import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkedSrcDirs = [
  path.join(repoRoot, "packages", "shared-ui", "src"),
];
const desktopSrcDirs = [
  path.join(repoRoot, "src"),
];
const fileIconRoot = path.join(repoRoot, "packages", "shared-ui", "src", "file");
const fileIconThemeRoot = path.join(fileIconRoot, "icon-themes");

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
const workspaceOpeningPrivateSymbols = [
  "openWorkspaceInCurrentWindow",
  "openWorkspaceInNewWindow",
  "selectWorkspaceFolder",
  "selectWorkspaceFolderInNewWindow",
];
const workspaceOpeningAllowedFiles = new Set([
  path.join(repoRoot, "src", "lib", "localFiles.ts"),
  path.join(repoRoot, "src", "lib", "workspaceOpening.ts"),
  path.join(repoRoot, "src", "types", "electron.d.ts"),
]);
const errors = [
  ...findBoundaryErrors(checkedSrcDirs, blockedImports),
  ...findBoundaryErrors(desktopSrcDirs, blockedDesktopImports),
  ...findDesktopWorkspaceOpeningErrors(desktopSrcDirs),
  ...findDesktopSharedTreeCssErrors([
    path.join(repoRoot, "src", "styles.css"),
  ]),
  ...findFileIconThemeArchitectureErrors(),
];

if (errors.length > 0) {
  console.error("shared UI boundary check failed:");
  for (const error of errors) {
    if (error.kind === "css-selector") {
      console.error(
        `- ${path.relative(repoRoot, error.filePath)} defines "${error.specifier}" (${error.reason})`,
      );
    } else if (error.kind === "workspace-open-api") {
      console.error(
        `- ${path.relative(repoRoot, error.filePath)} references "${error.specifier}" (${error.reason})`,
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
        reason: "ExplorerTree component selectors belong in packages/shared-ui/src/styles/data-workspace.css; standalone desktop should override --po-tree-* variables instead",
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

function findDesktopWorkspaceOpeningErrors(srcDirs) {
  const boundaryErrors = [];
  const symbolPatterns = workspaceOpeningPrivateSymbols.map((symbol) => ({
    symbol,
    pattern: new RegExp(`\\b${symbol}\\b`),
  }));

  for (const srcDir of srcDirs) {
    for (const filePath of walk(srcDir)) {
      if (!/\.(ts|tsx)$/.test(filePath)) continue;
      if (workspaceOpeningAllowedFiles.has(filePath)) continue;

      const source = readFileSync(filePath, "utf8");
      for (const { symbol, pattern } of symbolPatterns) {
        if (!pattern.test(source)) continue;

        boundaryErrors.push({
          kind: "workspace-open-api",
          filePath,
          specifier: symbol,
          reason: "workspace opening lifecycle must go through src/lib/workspaceOpening.ts",
        });
      }
    }
  }

  return boundaryErrors;
}

function findFileIconThemeArchitectureErrors() {
  const architectureErrors = [];
  const requiredThemePaths = [
    "iconThemeTypes.ts",
    "themeFactory.tsx",
    "registry.ts",
    "shared/PreviewShell.tsx",
    "shared/semanticGlyphs.tsx",
    "default/index.ts",
    "default/glyphs.tsx",
    "default/previews.tsx",
    "lines/index.tsx",
    "semantic/index.ts",
    "semantic/glyphs.tsx",
    "material/index.ts",
    "material/glyphs.tsx",
    "minimal/index.tsx",
  ];

  for (const relativePath of requiredThemePaths) {
    const filePath = path.join(fileIconThemeRoot, relativePath);
    if (!existsSync(filePath)) {
      architectureErrors.push({
        filePath,
        specifier: relativePath,
        reason: "the file-icon theme architecture is incomplete",
      });
    }
  }

  const compatibilityEntry = path.join(fileIconRoot, "fileIconThemeRegistry.tsx");
  if (existsSync(compatibilityEntry)) {
    const source = readFileSync(compatibilityEntry, "utf8");
    if (/<svg\b|function\s+render|const\s+\w+Theme\b/.test(source)) {
      architectureErrors.push({
        filePath: compatibilityEntry,
        specifier: "theme implementation",
        reason: "the compatibility entry must remain a thin re-export; theme rendering belongs in icon-themes",
      });
    }
  }

  const visualKindContract = path.join(fileIconRoot, "fileIconTypes.ts");
  if (existsSync(visualKindContract)) {
    const source = readFileSync(visualKindContract, "utf8");
    if (!/export\s+type\s+FileVisualKind\s*=\s*FileSemanticKind\s*;/.test(source)) {
      architectureErrors.push({
        filePath: visualKindContract,
        specifier: "FileVisualKind",
        reason: "the icon layer must alias the format registry's semantic kind instead of maintaining a second union",
      });
    }
  }

  const requiredThemeFactories = new Map([
    ["default/index.ts", "createCustomPreviewIconTheme"],
    ["lines/index.tsx", "createThemeVariant"],
    ["semantic/index.ts", "createIconTheme"],
    ["material/index.ts", "createIconTheme"],
    ["minimal/index.tsx", "createIconTheme"],
  ]);
  for (const [relativePath, factoryName] of requiredThemeFactories) {
    const filePath = path.join(fileIconThemeRoot, relativePath);
    if (!existsSync(filePath)) continue;
    const source = readFileSync(filePath, "utf8");
    const factoryCallPattern = new RegExp(`\\b${factoryName}\\s*\\(`);
    if (!factoryCallPattern.test(source)) {
      architectureErrors.push({
        filePath,
        specifier: factoryName,
        reason: "theme definitions must use the coverage-enforcing theme factory",
      });
    }
  }

  for (const themeName of ["default", "lines", "semantic", "material", "minimal"]) {
    const themeDirectory = path.join(fileIconThemeRoot, themeName);
    if (!existsSync(themeDirectory)) continue;
    for (const filePath of walk(themeDirectory)) {
      if (!/\.(?:ts|tsx)$/.test(filePath)) continue;
      const source = readFileSync(filePath, "utf8");
      for (const specifier of collectSpecifiers(source)) {
        if (
          /(?:^|\/)registry$/.test(specifier)
          || /(?:^|\/)fileIcons$/.test(specifier)
          || /(?:^|\/)fileIconThemeRegistry$/.test(specifier)
        ) {
          architectureErrors.push({
            filePath,
            specifier,
            reason: "theme implementations may depend on contracts/shared primitives, never the registry or public facade",
          });
        }
      }
    }
  }

  const semanticRendererFiles = [
    "default/glyphs.tsx",
    "default/previews.tsx",
    "material/glyphs.tsx",
    "semantic/glyphs.tsx",
    "minimal/index.tsx",
  ];
  const hiddenSemanticFallbackPatterns = [
    {
      pattern: /Partial\s*<\s*Record\s*<\s*FileVisualKind\s*,\s*FileIconRenderer/,
      specifier: "partial semantic renderer map",
    },
    {
      pattern: /Partial\s*<\s*Record\s*<\s*FileVisualKind\s*,\s*LucideIcon/,
      specifier: "partial semantic Lucide map",
    },
    {
      pattern: /\?\?\s*(?:render\w*(?:Document|File|Label)\w*|LucideFile)/,
      specifier: "implicit generic icon fallback",
    },
  ];

  for (const relativePath of semanticRendererFiles) {
    const filePath = path.join(fileIconThemeRoot, relativePath);
    if (!existsSync(filePath)) continue;
    const source = readFileSync(filePath, "utf8");
    for (const { pattern, specifier } of hiddenSemanticFallbackPatterns) {
      if (!pattern.test(source)) continue;
      architectureErrors.push({
        filePath,
        specifier,
        reason: "base themes must map every file semantic explicitly so omissions fail during type-checking",
      });
    }
  }

  return architectureErrors;
}
