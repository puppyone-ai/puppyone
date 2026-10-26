// Pure product oracle for Markdown automatic column tracks (no browser / IO).
// node tools/reference-markdown-layout.mjs [--check]
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {productRoot} from './product-source.mjs';
const root = path.resolve(import.meta.dirname, '..');
const source = 'packages/shared-ui/src/editor/markdown/features/table/markdownTableColumnLayout.ts';
const geometry = 'packages/shared-ui/src/editor/markdown/platform/codemirror/embeddedTableColumnGeometry.ts';
const modules = process.env.PUPPYONE_NODE_MODULES ?? path.join(productRoot, 'node_modules');
const {build} = await import(pathToFileURL(path.join(modules, 'esbuild/lib/main.js')));
const bundle = await build({entryPoints: [path.join(productRoot, source)], bundle: true, write: false, platform: 'node', format: 'esm'});
const product = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const tables = {
  compact: [['Name', 'Value'], ['a', 'b']],
  mixed: [['Status', 'Description', '备注'], ['PASS', 'A longer description with words that should wrap in a narrow reading column.', '基本没做到']],
  wide: [['Long heading', 'Code path'], ['x'.repeat(160), '`src/features/markdown/style/long-file-name.rs`']],
  cjk: [['状态', '说明', '验证'], ['部分做到', '这是一个中英文混合的表格，会随阅读栏宽度调整，但短列不应该被强制折行。', 'PASS']],
  markup: [['Kind', 'Visible text'], ['link', '[short](https://example.com/a/very/long/target) **bold** __strong__ ~~strike~~'], ['code', '`monospace` <https://example.org> escaped \\*x\\*<br/>next line']],
  overflow: [Array(20).fill('Column'), Array(20).fill('unbreakableword')],
  sampled: [['Key', 'Value'], ...Array.from({length: 160}, (_, i) => [`${i}`, i === 159 ? 'last-row-is-also-sampled' : 'data'])],
};
const cases = [];
for (const [table, rows] of Object.entries(tables)) for (const width of [150, 320, 724, 1000]) for (const font of [12, 13, 14]) {
  const model = rows.map((cells, index) => ({header: index === 0, cells: cells.map(text => ({text}))}));
  cases.push({id: `${table}/${width}/${font}`, table, width, font,
    tracks: product.estimateMarkdownTableColumnWidths(Array(rows[0].length).fill(null), model, {availableWidth: width, fontSize: font, cellInset: 21})});
}
const inputs = {};
for (const file of [source, geometry]) inputs[file] = createHash('sha256').update(await readFile(path.join(productRoot, file))).digest('hex');
const result = {sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: productRoot, encoding: 'utf8'}).trim(), inputs, tables, cases};
const out = path.join(root, 'fixtures/editor/table-layout.json');
const text = JSON.stringify(result, null, 1) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(out, 'utf8') !== text) throw Error('Stale table-layout.json');
} else await writeFile(out, text);
console.log(`${cases.length} product column-layout cases ${process.argv.includes('--check') ? 'verified' : 'written'}.`);
