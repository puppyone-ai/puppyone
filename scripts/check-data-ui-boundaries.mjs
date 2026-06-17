import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkedSrcDirs = [
  path.join(repoRoot, "packages", "data-ui", "src"),
  path.join(repoRoot, "packages", "editor-ui", "src"),
];

const blockedImports = [
  { pattern: /^@\//, reason: "cloud frontend alias" },
  { pattern: /^next(\/|$)/, reason: "Next.js runtime" },
  { pattern: /^electron(\/|$)/, reason: "Electron runtime" },
  { pattern: /^@supabase\//, reason: "cloud auth/runtime" },
  { pattern: /^swr$/, reason: "cloud data fetching runtime" },
  { pattern: /frontend\//, reason: "cloud frontend source" },
  { pattern: /cloud-source\//, reason: "desktop cloud mirror" },
];

const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const errors = [];

for (const srcDir of checkedSrcDirs) {
  for (const filePath of walk(srcDir)) {
    if (!/\.(ts|tsx)$/.test(filePath)) continue;

    const source = readFileSync(filePath, "utf8");
    for (const specifier of collectSpecifiers(source)) {
      const blocked = blockedImports.find(({ pattern }) => pattern.test(specifier));
      if (!blocked) continue;

      errors.push({
        filePath,
        specifier,
        reason: blocked.reason,
      });
    }
  }
}

if (errors.length > 0) {
  console.error("shared UI boundary check failed:");
  for (const error of errors) {
    console.error(
      `- ${path.relative(repoRoot, error.filePath)} imports "${error.specifier}" (${error.reason})`,
    );
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
