#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(repoRoot, "public");
const catalogPath = path.join(
  repoRoot,
  "src/shared-ui/core/rendererAssetCatalog.ts",
);
const agentBrandCatalogPath = path.join(
  repoRoot,
  "src/shared-ui/core/agentBrandCatalog.ts",
);
const imageExtensionPattern = /\.(?:gif|ico|jpe?g|png|svg|tiff|webp)$/i;
const canonicalFilenamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:gif|ico|jpe?g|png|svg|tiff|webp)$/;
const allowedRoots = [
  "assets/brand/puppy/",
  "assets/icons/agents/",
  "assets/icons/integrations/",
  "assets/icons/ui/",
  "assets/media/demos/",
  "assets/media/diagrams/",
  "assets/media/screenshots/",
];
const errors = [];

for (const filePath of walk(path.join(repoRoot, "src"))) {
  if (!/\.(?:css|[cm]?[jt]sx?)$/.test(filePath)) continue;
  if (filePath === catalogPath || filePath === agentBrandCatalogPath) continue;
  const source = readFileSync(filePath, "utf8");
  if (source.includes("assets/icons/agents/")) {
    errors.push(`${path.relative(repoRoot, filePath)} hard-codes an Agent mark; use AGENT_BRAND_CATALOG or AgentBrandImage`);
  }
  if (source.includes("RENDERER_ASSET_PATHS.icons.agents")) {
    errors.push(`${path.relative(repoRoot, filePath)} bypasses the Agent brand registry; use AGENT_BRAND_CATALOG or AgentBrandImage`);
  }
}

if (existsSync(path.join(publicRoot, "icons"))) {
  errors.push("public/icons is retired; renderer images belong under public/assets");
}

const publicImages = walk(publicRoot)
  .map((filePath) => relativeToPublic(filePath))
  .filter((filePath) => imageExtensionPattern.test(filePath));
const catalogSource = readFileSync(catalogPath, "utf8");
const catalogImages = new Set(
  [...catalogSource.matchAll(/"(assets\/[^"\n]+\.(?:gif|ico|jpe?g|png|svg|tiff|webp))"/gi)]
    .map((match) => match[1]),
);

for (const imagePath of publicImages) {
  if (!allowedRoots.some((root) => imagePath.startsWith(root))) {
    errors.push(`renderer image is outside an owned asset collection: public/${imagePath}`);
  }
  if (!canonicalFilenamePattern.test(path.posix.basename(imagePath))) {
    errors.push(`renderer image filename must be lowercase kebab-case: public/${imagePath}`);
  }
  if (!catalogImages.has(imagePath)) {
    errors.push(`renderer image is missing from RENDERER_ASSET_PATHS: public/${imagePath}`);
  }
}

for (const imagePath of catalogImages) {
  if (!existsSync(path.join(publicRoot, imagePath))) {
    errors.push(`RENDERER_ASSET_PATHS references a missing file: public/${imagePath}`);
  }
}

const firstPathByHash = new Map();
for (const imagePath of publicImages) {
  const hash = createHash("sha256")
    .update(readFileSync(path.join(publicRoot, imagePath)))
    .digest("hex");
  const duplicate = firstPathByHash.get(hash);
  if (duplicate) {
    errors.push(`duplicate renderer images must share one canonical path: public/${duplicate}, public/${imagePath}`);
  } else {
    firstPathByHash.set(hash, imagePath);
  }
}

if (errors.length > 0) {
  console.error("Renderer asset architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Renderer asset architecture check passed (${publicImages.length} cataloged images).`);

function relativeToPublic(filePath) {
  return path.relative(publicRoot, filePath).replaceAll(path.sep, "/");
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filePath) : [filePath];
  });
}
