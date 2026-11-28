// User-facing vocabulary gate for the native-only copy (assets/native-locales.json).
//
// The product's `scripts/check-user-vocabulary.mjs` checks `locales/renderer/**`
// against the Vocabulary table of puppy-issues `document/product-philosophy.md`;
// this applies the same generated rules and the same matcher, imported from the
// pinned checkout rather than copied, to the strings only this app has. The
// baseline exempts strings that predate the gate and may only shrink.
//
// Usage: node tools/check-native-vocabulary.mjs [--prune]
import path from 'node:path';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {productRoot} from './product-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = 'tools/native-vocabulary-baseline.json';
const {findVocabularyViolations, compareVocabularyBaseline, rulesPath} =
  await import(pathToFileURL(path.join(productRoot, 'scripts/check-user-vocabulary.mjs')).href);
const {rules} = JSON.parse(readFileSync(path.join(productRoot, rulesPath), 'utf8'));
const {catalogs} = JSON.parse(readFileSync(path.join(root, 'assets/native-locales.json'), 'utf8'));
const violations = findVocabularyViolations(rules, Object.entries(catalogs)
  .map(([locale, catalog]) => ({file: `assets/native-locales.json#${locale}`, catalog})));
const baseline = JSON.parse(readFileSync(path.join(root, baselinePath), 'utf8'));
const {current, added, stale} = compareVocabularyBaseline(baseline.violations, violations);

if (process.argv.includes('--prune')) {
  writeFileSync(path.join(root, baselinePath),
    JSON.stringify({...baseline, violations: baseline.violations.filter((id) => current.includes(id))}, null, 2) + '\n');
  console.log(`Pruned ${stale.length} fixed exemptions from ${baselinePath}`);
  process.exit(0);
}
if (added.length) {
  throw new Error(`Native copy uses system-view wording:\n${added.map((v) => `  ${v.message}`).join('\n')}`);
}
if (stale.length) {
  throw new Error(`${baselinePath} exempts strings that no longer violate (run with --prune):\n  ${stale.join('\n  ')}`);
}
console.log(`Native vocabulary verified: ${rules.length} rules, ${current.length} baseline exemptions`);
