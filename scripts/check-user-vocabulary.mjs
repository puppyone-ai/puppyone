#!/usr/bin/env node

// User-facing vocabulary gate for `locales/renderer/**`.
//
// The rules have a single source: the Vocabulary table in
// `puppy-issues:document/product-philosophy.md`. Product documentation lives in
// another repository, so the derived rules are committed here as a generated
// artifact and every run that can reach the document verifies the artifact
// still matches it. The digest covers the table only, so unrelated edits to the
// philosophy document never invalidate this gate.
//
// Only user-facing resource values are scanned. Code identifiers and internal
// documents keep the system vocabulary (`publish`, `materialize`, `working
// copy`) because that is the correct wording there.
//
// Usage:
//   node scripts/check-user-vocabulary.mjs [--prune]
//   node scripts/check-user-vocabulary.mjs --sync [--philosophy <path>]

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const rulesPath = "scripts/user-vocabulary-rules.json";
export const baselinePath = ".user-vocabulary-known-violations.json";
export const localesRoot = "locales/renderer";
export const documentRepository = "puppy-issues";
export const documentPath = "document/product-philosophy.md";
export const documentSection = "Vocabulary";
const candidateDocumentRoots = ["../puppy-issues", "../../puppy-issues"];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(parseArguments(process.argv.slice(2)));
}

function main(options) {
  const philosophyFile = resolvePhilosophyFile(options.philosophy);
  if (options.sync) {
    syncRules(philosophyFile);
    return;
  }
  const committed = readJson(rulesPath);
  verifyRuleProvenance(philosophyFile, committed);
  const violations = findVocabularyViolations(committed.rules, readCatalogs());
  if (!existsSync(path.join(repositoryRoot, baselinePath))) {
    // The first run records existing debt instead of blocking unrelated work.
    writeJson(baselinePath, createBaseline(violations.map((violation) => violation.id)));
    console.log(`Recorded ${violations.length} pre-existing user-facing vocabulary violation(s) in ${baselinePath}.`);
    return;
  }
  reportResult({ philosophyFile, committed, violations, prune: options.prune });
}

function syncRules(philosophyFile) {
  if (!philosophyFile) {
    fail([`${documentRepository}:${documentPath} is not reachable; pass --philosophy <path> to regenerate ${rulesPath}`]);
  }
  const derived = deriveVocabularyRules(readFileSync(philosophyFile, "utf8"), readDocumentCommit(philosophyFile));
  writeJson(rulesPath, derived);
  console.log(`Synchronized ${rulesPath} from ${derived.source.provenance}: ${derived.rules.length} prohibited terms.`);
}

function verifyRuleProvenance(philosophyFile, committed) {
  if (!philosophyFile) return;
  const derived = deriveVocabularyRules(readFileSync(philosophyFile, "utf8"), readDocumentCommit(philosophyFile));
  if (derived.source.tableDigest === committed.source.tableDigest) return;
  fail([
    `${rulesPath} no longer matches the ${documentSection} table in ${documentRepository}:${documentPath}`,
    "run node scripts/check-user-vocabulary.mjs --sync and review the regenerated rules",
  ]);
}

function reportResult({ philosophyFile, committed, violations, prune }) {
  const baseline = readJson(baselinePath);
  const { added, stale, current } = compareVocabularyBaseline(baseline.violations, violations);
  if (added.length > 0) {
    fail([
      "new user-facing strings use system-view vocabulary:",
      ...added.map((violation) => `  ${violation.message}`),
      `${baselinePath} only exempts the strings that already existed; it may shrink, never grow`,
    ]);
  }
  if (stale.length > 0 && !prune) {
    fail([
      `${baselinePath} exempts ${stale.length} string(s) that no longer exist:`,
      ...stale.map((id) => `  ${id}`),
      "run node scripts/check-user-vocabulary.mjs --prune to record the reduction",
    ]);
  }
  if (stale.length > 0) {
    // Written only after proving the scan is a subset of the recorded baseline.
    writeJson(baselinePath, createBaseline(current));
  }
  const scope = philosophyFile
    ? `${committed.source.provenance}, verified against the working copy of ${documentPath}`
    : `${committed.source.provenance} (document not reachable)`;
  console.log(
    `User-facing vocabulary check passed: ${committed.rules.length} prohibited terms from ${scope};`
    + ` ${current.length} exempt legacy string(s), ${stale.length} removed.`,
  );
}

function parseArguments(argv) {
  const parsed = { sync: false, prune: false, philosophy: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--sync") parsed.sync = true;
    else if (argument === "--prune") parsed.prune = true;
    else if (argument === "--philosophy") parsed.philosophy = argv[(index += 1)];
    else if (argument.startsWith("--philosophy=")) parsed.philosophy = argument.slice("--philosophy=".length);
    else throw new Error(`Usage: node scripts/check-user-vocabulary.mjs [--prune] [--sync [--philosophy <path>]] (got ${argument})`);
  }
  return parsed;
}

function resolvePhilosophyFile(explicit) {
  const candidates = explicit
    ? [explicit]
    : [
      process.env.PUPPYONE_PRODUCT_PHILOSOPHY,
      ...candidateDocumentRoots.map((root) => path.join(root, documentPath)),
    ].filter(Boolean);
  return candidates.map((candidate) => path.resolve(repositoryRoot, candidate)).find((candidate) => existsSync(candidate)) ?? null;
}

export function deriveVocabularyRules(markdown, commit = "unknown") {
  const table = readVocabularyTable(markdown);
  const sanctioned = new Set(table.flatMap((row) => splitCell(row.userFacing)).map((term) => term.toLowerCase()));
  const rules = [];
  const skipped = [];
  for (const row of table) {
    for (const term of splitCell(row.prohibited)) {
      if (rules.some((rule) => rule.term.toLowerCase() === term.toLowerCase())) continue;
      if (sanctioned.has(term.toLowerCase())) {
        // The same word is the sanctioned wording in another row (`Cloud`), so
        // banning it mechanically would contradict the table it came from.
        skipped.push({ term, reason: `sanctioned user-facing wording elsewhere in the ${documentSection} table` });
        continue;
      }
      rules.push({ term, concept: row.concept, userFacing: row.userFacing });
    }
  }
  return {
    generated: "node scripts/check-user-vocabulary.mjs --sync",
    source: {
      provenance: `${documentRepository}@${commit}:${documentPath}#${documentSection.toLowerCase()}`,
      tableDigest: createHash("sha256").update(table.map((row) => row.raw).join("\n")).digest("hex"),
    },
    rules,
    skipped,
  };
}

function readVocabularyTable(markdown) {
  const section = markdown.split(new RegExp(`^## ${documentSection}$`, "m"))[1]?.split(/^## /m)[0];
  if (!section) throw new Error(`${documentPath} has no "## ${documentSection}" section`);
  const rows = section.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("|"))
    .map((raw) => ({ raw, columns: raw.replace(/^\|/, "").replace(/\|$/, "").split("|").map((column) => column.trim()) }))
    .filter((row) => row.columns.length === 4 && !/^[\s|:-]+$/.test(row.raw) && row.columns[0] !== "概念");
  if (rows.length === 0) throw new Error(`${documentPath} has no parsable ${documentSection} rows`);
  return rows.map(({ raw, columns }) => ({
    raw, concept: columns[0], internal: columns[1], userFacing: columns[2], prohibited: columns[3],
  }));
}

function readDocumentCommit(file) {
  try {
    return execFileSync("git", ["-C", path.dirname(file), "log", "-1", "--format=%h", "--", path.basename(file)], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

// Table cells are prose: a parenthesised aside is commentary, `，`/`、`/`,`
// separate alternatives, ` / ` separates a Chinese and an English spelling, and
// a mixed `备份 Backup` cell names the same concept in both scripts.
function splitCell(cell) {
  return cell.replace(/（[^）]*）/g, " ")
    .split(/[，,、]|\s+\/\s+/)
    .flatMap((part) => splitScripts(part.trim()))
    .filter(Boolean);
}

function splitScripts(part) {
  if (!part) return [];
  const chinese = part.match(/[㐀-鿿]+/g) ?? [];
  const latin = part.replace(/[㐀-鿿]+/g, " ").replace(/\s+/g, " ").trim();
  if (chinese.length === 0) return latin ? [latin] : [];
  return latin ? [...chinese, latin] : chinese;
}

export function buildVocabularyPattern(term) {
  if (/[㐀-鿿]/.test(term)) return new RegExp(escapeRegExp(term));
  // Latin terms are matched as whole words with their common inflections, so
  // `Pulling`, `Syncs` and `Merged` cannot slip past a ban on the stem.
  const pattern = (value) => escapeRegExp(value).replace(/\s+/g, "\\s+");
  const forms = [`${pattern(term)}(?:e?s|d|ed|ing)?`];
  if (/e$/i.test(term)) forms.push(`${pattern(term.slice(0, -1))}(?:ed|ing)`);
  return new RegExp(`\\b(?:${forms.join("|")})\\b`, "i");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findVocabularyViolations(rules, catalogs) {
  const patterns = rules.map((rule) => ({ ...rule, pattern: buildVocabularyPattern(rule.term) }));
  const violations = [];
  for (const { file, catalog } of catalogs) {
    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value !== "string") continue;
      const copy = maskNonCopy(value);
      for (const rule of patterns) {
        if (!rule.pattern.test(copy)) continue;
        violations.push({
          id: `${file} ${key} ${rule.term}`,
          message: `${file} ${key}: "${rule.term}" is system-view wording for ${rule.concept}; ${describeGuidance(rule)}`,
        });
      }
    }
  }
  return violations.sort((left, right) => left.id.localeCompare(right.id));
}

// Some concepts have no user-facing term at all: the table then asks for a
// sentence about the consequence rather than a replacement word.
function describeGuidance(rule) {
  return splitCell(rule.userFacing).length > 0
    ? `say ${rule.userFacing}`
    : `describe the consequence instead ${rule.userFacing}`;
}

// Placeholder names and URLs are identifiers, not wording the user reads.
// Plural and select bodies stay visible because they do carry copy.
function maskNonCopy(value) {
  return value.replace(/https?:\/\/\S+/g, " ").replace(/\{[A-Za-z0-9_]+\}/g, " ");
}

export function compareVocabularyBaseline(recordedIds, violations) {
  const recorded = new Set(recordedIds);
  const current = [...new Set(violations.map((violation) => violation.id))].sort();
  const seen = new Set(current);
  return {
    current,
    added: violations.filter((violation) => !recorded.has(violation.id)),
    stale: recordedIds.filter((id) => !seen.has(id)),
  };
}

function readCatalogs() {
  return readdirSync(path.join(repositoryRoot, localesRoot), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((locale) => readdirSync(path.join(repositoryRoot, localesRoot, locale.name))
      .filter((name) => name.endsWith(".json"))
      .map((name) => `${localesRoot}/${locale.name}/${name}`))
    .sort()
    .map((file) => ({ file, catalog: readJson(file) }));
}

function createBaseline(violations) {
  return {
    comment: `Pre-existing ${localesRoot} strings exempted from scripts/check-user-vocabulary.mjs. This list may only shrink.`,
    violations,
  };
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
}

function writeJson(relativePath, value) {
  writeFileSync(path.join(repositoryRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function fail(lines) {
  console.error("User-facing vocabulary check failed:");
  for (const line of lines) console.error(`- ${line}`);
  console.error(`Vocabulary authority: ${documentRepository}:${documentPath}#${documentSection.toLowerCase()}.`);
  process.exit(1);
}
