#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(repoRoot, "dist");
const publicRoot = path.join(repoRoot, "public");
const rendererAssetCatalogPath = path.join(
  repoRoot,
  "src/shared-ui/core/rendererAssetCatalog.ts",
);
const rootRelativeAssetPattern = /(["'`])\/(?!\/)[^"'`]+\.(?:png|svg|webp|jpe?g|gif|ico|woff2?)(?:[?#][^"'`]*)?\1/gi;
const rendererAssetCallPattern = /resolveRendererPublicAssetUrl\(\s*(["'`])([^"'`]+)\1\s*\)/g;
const cssPublicAssetPattern = /url\(\s*(["']?)\/(?!\/)([^"')]+\.(?:png|svg|webp|jpe?g|gif|ico|woff2?))\1\s*\)/gi;
const errors = [];
const checkedAssetPaths = new Set();

for (const filePath of walk(distRoot)) {
  if (!/\.(?:html|[cm]?js)$/.test(filePath)) continue;
  const source = readFileSync(filePath, "utf8");
  const matches = source.match(rootRelativeAssetPattern) ?? [];
  if (matches.length > 0) {
    errors.push(`${path.relative(repoRoot, filePath)} contains ${matches.join(", ")}`);
  }
}

for (const filePath of walk(path.join(repoRoot, "src"))) {
  if (!/\.(?:css|[cm]?[jt]sx?)$/.test(filePath)) continue;
  const source = readFileSync(filePath, "utf8");
  const assetPaths = filePath.endsWith(".css")
    ? [...source.matchAll(cssPublicAssetPattern)].map((match) => match[2])
    : [...source.matchAll(rendererAssetCallPattern)].map((match) => match[2]);

  for (const assetPath of assetPaths) {
    checkAssetPath(assetPath, path.relative(repoRoot, filePath));
  }
}

const assetCatalogSource = readFileSync(rendererAssetCatalogPath, "utf8");
const catalogAssetPaths = [
  ...assetCatalogSource.matchAll(/"(assets\/[^"\n]+\.(?:png|svg|webp|jpe?g|gif|ico))"/gi),
].map((match) => match[1]);
for (const assetPath of catalogAssetPaths) {
  checkAssetPath(assetPath, path.relative(repoRoot, rendererAssetCatalogPath));
}

if (errors.length > 0) {
  console.error("Renderer public asset check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Renderer public asset check passed.");

function checkAssetPath(assetPath, sourcePath) {
  if (checkedAssetPaths.has(assetPath)) return;
  checkedAssetPaths.add(assetPath);
  if (!existsSync(path.join(publicRoot, assetPath))) {
    errors.push(`${sourcePath} references missing public/${assetPath}`);
  }
  if (!existsSync(path.join(distRoot, assetPath))) {
    errors.push(`${sourcePath} references missing dist/${assetPath}`);
  }
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filePath) : [filePath];
  });
}
