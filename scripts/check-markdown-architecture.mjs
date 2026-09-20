import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharedUiSourceRoot = path.join(repoRoot, "packages", "shared-ui", "src");
const markdownRoot = path.join(repoRoot, "packages", "shared-ui", "src", "editor", "markdown");
const compositionRoot = path.join(markdownRoot, "composition");
const coreRoot = path.join(markdownRoot, "core");
const featuresRoot = path.join(markdownRoot, "features");
const platformRoot = path.join(markdownRoot, "platform");
const sharedRoot = path.join(markdownRoot, "shared");
const codeMirrorRoot = path.join(sharedUiSourceRoot, "editor", "codemirror");
const legacyDirectories = [
  "adapters",
  "decorations",
  "keymap",
  "links",
  "plans",
  "policy",
  "rendering",
  "semantic",
  "services",
  "state",
  "syntax",
  "widgets",
];
const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const errors = [];
const removedArchitectureFiles = [
  path.join(coreRoot, "syntax", "markdownParserExtensions.ts"),
  path.join(featuresRoot, "blockFeatureRegistry.ts"),
  path.join(featuresRoot, "inlineFeatureRegistry.ts"),
];

for (const removedFile of removedArchitectureFiles) {
  if (existsSync(removedFile)) {
    errors.push(`${relative(removedFile)} was removed; register the feature once in composition`);
  }
}

for (const directory of legacyDirectories) {
  const legacyPath = path.join(markdownRoot, directory);
  if (existsSync(legacyPath)) {
    errors.push(`${relative(legacyPath)} is a legacy horizontal directory`);
  }
}

for (const filePath of walkTypeScript(markdownRoot)) {
  const source = readFileSync(filePath, "utf8");
  for (const specifier of collectSpecifiers(source)) {
    const target = resolveRelativeModule(filePath, specifier);
    if (!target) continue;

    if (isInside(filePath, sharedRoot) && (
      isInside(target, compositionRoot) ||
      isInside(target, coreRoot) ||
      isInside(target, featuresRoot) ||
      isInside(target, platformRoot)
    )) {
      errors.push(`${relative(filePath)} imports ${relative(target)}; shared is the dependency floor`);
    }

    if (isInside(filePath, platformRoot) && (
      isInside(target, compositionRoot) || isInside(target, featuresRoot)
    )) {
      errors.push(`${relative(filePath)} imports ${relative(target)}; platform cannot depend on composition or a feature`);
    }

    if (isInside(filePath, coreRoot) && (
      isInside(target, compositionRoot) || isInside(target, featuresRoot)
    )) {
      errors.push(`${relative(filePath)} imports ${relative(target)}; core must use the injected Feature Composition contract`);
    }

    if (isInside(filePath, featuresRoot) && isInside(target, compositionRoot)) {
      errors.push(`${relative(filePath)} imports ${relative(target)}; inject a leaf port instead of depending on composition`);
    }
  }

  if (/Plan\.ts$/i.test(filePath)) {
    if (/from\s+["']@codemirror\/view["']/.test(source)) {
      errors.push(`${relative(filePath)} imports @codemirror/view; plans must stay DOM-free`);
    }
    if (/\b(?:document|window|HTMLElement|Element)\b/.test(stripComments(source))) {
      errors.push(`${relative(filePath)} references browser DOM; plans must stay pure`);
    }
  }
}

for (const filePath of walkTypeScript(sharedUiSourceRoot)) {
  if (filePath === markdownRoot || isInside(filePath, markdownRoot)) continue;
  const source = readFileSync(filePath, "utf8");
  for (const specifier of collectSpecifiers(source)) {
    const target = resolveRelativeModule(filePath, specifier);
    if (!target) continue;
    if (
      isInside(target, coreRoot) ||
      isInside(target, compositionRoot) ||
      isInside(target, featuresRoot) ||
      isInside(target, platformRoot) ||
      isInside(target, sharedRoot)
    ) {
      errors.push(`${relative(filePath)} imports Markdown internals ${relative(target)}; use editor/markdown/index.ts`);
    }
  }
}

for (const filePath of walkTypeScript(codeMirrorRoot)) {
  const source = readFileSync(filePath, "utf8");
  for (const specifier of collectSpecifiers(source)) {
    const target = resolveRelativeModule(filePath, specifier);
    if (target && isInside(target, markdownRoot)) {
      errors.push(`${relative(filePath)} imports a format; shared engine layout must remain format-neutral`);
    }
  }
  const code = stripComments(source);
  if (/\.(?:measure|readMeasured)\s*\(/.test(code)) {
    errors.push(`${relative(filePath)} calls a private CodeMirror measurement API`);
  }
  if (/\.scrollTop\s*(?:[+\-*/]=|=(?!=)|\+\+|--)/.test(code)) {
    errors.push(`${relative(filePath)} writes scrollTop; use engine scroll effects to preserve one scroll owner`);
  }
}
const hostLayoutFile = path.join(sharedUiSourceRoot, "editor", "runtime", "editorLayout.ts");
if (collectSpecifiers(readFileSync(hostLayoutFile, "utf8")).some(specifier => /codemirror|markdown/i.test(specifier))) {
  errors.push(`${relative(hostLayoutFile)} imports an engine or format; the shell layout contract must remain engine-neutral`);
}

if (errors.length > 0) {
  console.error("Markdown architecture boundary check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Markdown architecture boundary check passed.");

function* walkTypeScript(directory) {
  for (const entry of readdirSync(directory)) {
    const filePath = path.join(directory, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) yield* walkTypeScript(filePath);
    else if (/\.tsx?$/.test(filePath)) yield filePath;
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

function resolveRelativeModule(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function isInside(target, directory) {
  const relativePath = path.relative(directory, target);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}
