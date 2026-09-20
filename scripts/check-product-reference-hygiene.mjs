#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = ["src", "packages", "electron", "local-api", "tests"];
const sourceExtensionPattern = /\.(?:css|html|[cm]?[jt]sx?|md)$/i;
const productName = String.raw`(?:Notion|Linear|Cursor|MarkText|VS[ -]?Code|Figma|Slack|Airtable|Obsidian|GitHub)`;
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

for (const root of scanRoots) {
  for (const filePath of collectSourceFiles(path.join(repoRoot, root))) {
    const source = readFileSync(filePath, "utf8");
    for (const rule of rules) {
      const match = rule.pattern.exec(source);
      if (!match) continue;
      const line = source.slice(0, match.index).split("\n").length;
      errors.push(`${path.relative(repoRoot, filePath)}:${line} ${rule.guidance}`);
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
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "archive") return [];
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(filePath);
    return entry.isFile() && sourceExtensionPattern.test(entry.name) ? [filePath] : [];
  });
}
