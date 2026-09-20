#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensionPattern = /\.(?:css|html|jsonc?|[cm]?[jt]sx?|md|ya?ml)$/i;
const skippedDirectories = new Set([
  ".git",
  "archive",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);
const skippedFiles = new Set([
  "THIRD_PARTY_NOTICES.md",
  "package-lock.json",
]);
const productName = String.raw`(?:Notion|Linear|Cursor|MarkText|VS[ -]?Code|Figma|Slack|Airtable|Obsidian|GitHub)`;
const externalProductNamePattern = new RegExp(productName, "i");
const rules = [
  {
    pattern: new RegExp(String.raw`\b${productName}[ -]style\b`, "i"),
    guidance: "replace external-product style labels with a PuppyOne-owned behavior contract",
  },
  {
    pattern: new RegExp(String.raw`\blike (?:a |an )?${productName}\b`, "i"),
    guidance: "describe the required layout or interaction directly instead of by analogy",
  },
  {
    pattern: new RegExp(String.raw`\bmatching ${productName}(?:'s)?\b`, "i"),
    guidance: "state the invariant that PuppyOne owns instead of naming a visual reference",
  },
  {
    pattern: new RegExp(String.raw`\binspired by ${productName}\b`, "i"),
    guidance: "move research provenance to evidence and keep source contracts product-owned",
  },
  {
    pattern: new RegExp(String.raw`\bweb search:\s*${productName}\b`, "i"),
    guidance: "use product-neutral synthetic copy in UI fixtures and smoke harnesses",
  },
];
const errors = [];

for (const filePath of collectSourceFiles(repoRoot)) {
  const source = readFileSync(filePath, "utf8");
  const relativePath = path.relative(repoRoot, filePath).split(path.sep).join("/");
  for (const rule of rules) {
    const match = rule.pattern.exec(source);
    if (!match) continue;
    const line = source.slice(0, match.index).split("\n").length;
    errors.push(`${relativePath}:${line} ${rule.guidance}`);
  }
  if (/^locales\/renderer\/[^/]+\/settings\.json$/.test(relativePath)) {
    const catalog = JSON.parse(source);
    for (const [key, value] of Object.entries(catalog)) {
      if (!key.startsWith("appearance.fileIcons.")) continue;
      if (!externalProductNamePattern.test(`${key} ${String(value)}`)) continue;
      errors.push(`${relativePath} ${key} must use a PuppyOne-owned icon-theme identity`);
    }
  }
}

if (errors.length > 0) {
  console.error("Product reference hygiene check failed:");
  for (const error of errors) console.error(`- ${error}`);
  console.error("Names required for integrations, providers, compatibility, assets, and licenses remain allowed.");
  process.exit(1);
}

console.log("Product reference hygiene check passed.");

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) return [];
    if (entry.isFile() && skippedFiles.has(entry.name)) return [];
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(filePath);
    return entry.isFile() && sourceExtensionPattern.test(entry.name) ? [filePath] : [];
  });
}
