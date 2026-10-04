import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const readabilityRules = new Set([
  "complexity", "max-depth", "max-params", "no-nested-ternary", "max-lines", "max-lines-per-function",
]);

export const baselineFiles = [
  "eslint-suppressions.json",
  ".dependency-cruiser-known-violations.json",
];

function normalizePaths(value, renames) {
  if (typeof value === "string") return renames.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => normalizePaths(item, renames));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, normalizePaths(item, renames)]));
}

export function baselineCounts(file, value, renames = new Map()) {
  const counts = new Map();
  if (file === "eslint-suppressions.json") {
    for (const [path, rules] of Object.entries(value)) {
      for (const [rule, { count }] of Object.entries(rules)) {
        if (!readabilityRules.has(rule) || !Number.isSafeInteger(count) || count < 1) {
          throw new Error(`Invalid readability suppression: ${path}:${rule} (${count})`);
        }
        const key = `${renames.get(path) ?? path}:${rule}`;
        counts.set(key, (counts.get(key) ?? 0) + count);
      }
    }
    return counts;
  }
  for (const violation of value) {
    const key = JSON.stringify(normalizePaths(violation, renames));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function compareBaseline(file, previous, current, renames = new Map()) {
  const oldCounts = baselineCounts(file, previous, renames);
  const newCounts = baselineCounts(file, current);
  return [...newCounts].filter(([key, count]) => count > (oldCounts.get(key) ?? 0))
    .map(([key, count]) => `${file}: ${key}: ${oldCounts.get(key) ?? 0} -> ${count}`);
}

function readRenames(base) {
  // Only byte-identical moves transfer debt. Similarity-based renames can
  // otherwise transfer an old allowance onto a newly written implementation.
  const records = execFileSync("git", ["diff", "--name-status", "-z", "--find-renames=100%", base, "--"],
    { encoding: "utf8" }).split("\0");
  const renames = new Map();
  while (records.length > 1) {
    const status = records.shift();
    const from = records.shift();
    if (status === "R100") renames.set(from, records.shift());
  }
  return renames;
}

export function checkBaselines(base) {
  // An invalid/missing comparison commit must fail, never silently disable CI.
  execFileSync("git", ["rev-parse", "--verify", `${base}^{commit}`], { stdio: "pipe" });
  const renames = readRenames(base);
  const errors = [];
  for (const file of baselineFiles) {
    const current = JSON.parse(readFileSync(file, "utf8"));
    if (file === "eslint-suppressions.json") {
      // ESLint only notices unused counts in files it actually visits. Cover
      // deleted files too; lint:prune removes their native suppressions.
      for (const path of Object.keys(current)) {
        if (!existsSync(path)) errors.push(`${file}: stale deleted file ${path}; run npm run lint:prune`);
      }
    }
    const tracked = execFileSync("git", ["ls-tree", "--name-only", base, "--", file], { encoding: "utf8" }).trim();
    const count = [...baselineCounts(file, current).values()].reduce((sum, value) => sum + value, 0);
    console.log(`${file}: ${count} recorded violations`);
    if (!tracked) {
      console.log(`Initial baseline: ${file} did not exist at ${base}.`);
      continue;
    }
    const previous = JSON.parse(execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }));
    errors.push(...compareBaseline(file, previous, current, renames));
  }
  if (errors.length) throw new Error(`Readability baselines may only decrease:\n${errors.join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkBaselines(process.argv[2] ?? process.env.READABILITY_BASE ?? "HEAD");
}
