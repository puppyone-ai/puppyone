import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compareBaseline } from "./readability-baselines.mjs";

const file = ".dependency-cruiser-known-violations.json";
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--prune")) {
  throw new Error("Usage: node scripts/check-dependency-baseline.mjs [--prune]");
}

// Scan unsuppressed output: --ignore-known does not detect stale entries and
// the JSON/baseline reporters return zero even when the graph has errors.
const executable = fileURLToPath(new URL("../node_modules/dependency-cruiser/bin/dependency-cruise.mjs", import.meta.url));
const current = JSON.parse(execFileSync(process.execPath, [executable,
  "src", "packages", "electron", "local-api", "shared",
  "--config", ".dependency-cruiser.cjs", "--output-type", "baseline",
], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
const previous = JSON.parse(readFileSync(file, "utf8"));
const additions = compareBaseline(file, previous, current);
if (additions.length) {
  throw new Error(`New dependency violations (baseline unchanged):\n${additions.join("\n")}`);
}
const stale = compareBaseline(file, current, previous);
if (stale.length && !args.includes("--prune")) {
  throw new Error(`Stale dependency baseline; run npm run check:dependencies:prune:\n${stale.join("\n")}`);
}
if (stale.length) {
  // Write only after proving the new graph is a subset of the old baseline.
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
}
console.log(`Dependency baseline: ${current.length} violations; removed ${stale.length} stale entries.`);
