// Intl.NumberFormat as the product calls it (`localization.formatNumber`):
// integers, decimals with a fraction cap, and currency with the narrow
// symbol, in every product language. The native formatter in
// src/localization.rs must answer the same; `--check` compares.
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const fixturePath = path.join(root, 'fixtures/ui/number-format-oracle.json');
const locales = ['en', 'es', 'pt-BR', 'fr', 'de', 'ja', 'ko', 'zh-Hans'];
const numbers = [0, 7, 12.5, 999, 1000, 1234.5, 9999, 10000, 12345.678, 1000000, 0.05, 0.25, 9.95, 99.96, 220, 3.2, -5, -0.04];
const cents = [0, 500, 1950, 2000, 4000, 12000, 123456, 1000000, 99999, -500];
const cases = [];
for (const locale of locales) {
  for (const value of numbers) {
    for (const max of [0, 1, 2]) {
      cases.push({locale, kind: 'decimal', value, max,
        expected: new Intl.NumberFormat(locale, {maximumFractionDigits: max}).format(value)});
    }
  }
  for (const cent of cents) {
    const fraction = cent % 100 === 0 ? 0 : 2;
    cases.push({locale, kind: 'currency', value: cent / 100, currency: 'USD', fraction,
      expected: new Intl.NumberFormat(locale, {style: 'currency', currency: 'USD',
        currencyDisplay: 'narrowSymbol', maximumFractionDigits: fraction}).format(cent / 100)});
  }
}
const output = JSON.stringify({icu: process.versions.icu, cases}, null, 1) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(fixturePath, 'utf8') !== output) throw Error('Stale number format oracle (run node tools/reference-number-format.mjs)');
} else {
  await writeFile(fixturePath, output);
}
console.log(`${cases.length} Intl.NumberFormat cases across ${locales.length} languages (ICU ${process.versions.icu})`);
