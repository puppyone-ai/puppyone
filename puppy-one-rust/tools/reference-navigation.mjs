// Execute actual reviewed TS resolvers. --record is allowed only for a new receipt.
import {readFile, writeFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {productRoot} from './product-source.mjs';
const root = path.resolve(import.meta.dirname, '..');
const receiptPath = path.join(root, 'fixtures/editor/navigation-reference.json');
const fixturePath = path.join(root, 'fixtures/editor/navigation.json');
const {build} = await import(pathToFileURL(path.join(productRoot, 'node_modules/esbuild/lib/main.js')));
const base = './packages/shared-ui/src/editor/markdown/';
const bundle = await build({stdin:{contents:`export {createMarkdownLinkGraph} from '${base}core/links/markdownLinkGraph.ts'; export {createMarkdownHeadingIndex} from '${base}core/links/markdownHeadingIndex.ts'; export {getSafeMarkdownHref} from '${base}platform/policy/markdownUrlPolicy.ts';`,resolveDir:productRoot},absWorkingDir:productRoot,bundle:true,write:false,platform:'node',format:'esm',metafile:true});
const inputs = {};
for (const input of Object.keys(bundle.metafile.inputs).filter(p => p !== '<stdin>').sort()) {
  inputs[input] = createHash('sha256').update(await readFile(path.join(productRoot,input))).digest('hex');
}
const locale = new Intl.Collator().resolvedOptions().locale;
if (!/^en(-|$)/.test(locale)) throw Error(`Oracle requires the reviewed en-US runtime; got ${locale}`);
let receipt;
if (process.argv.includes('--record')) {
  try { await access(receiptPath); throw Error('Receipt already exists; review drift explicitly'); } catch(e) { if (e.code !== 'ENOENT') throw e; }
  receipt = {checkout:path.relative(root,productRoot),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:productRoot,encoding:'utf8'}).trim(),locale,icu:process.versions.icu,inputs};
  await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');
} else {
  receipt = JSON.parse(await readFile(receiptPath,'utf8'));
  if (JSON.stringify(receipt.inputs) !== JSON.stringify(inputs)) throw Error('Reviewed navigation inputs drifted; do not silently repin');
}
const ts = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const paths = ['guide/source.md','guide/Target.md','root.md','guide/data.csv','guide/Report.json','other/Note.md','guide/nested/Note.markdown','ä/Note.md','a/Note.md','A/Note.md','Z/Note.md','中文/笔记.md','guide/Space Note.md','guide/foo.md','guide/foo.txt','guide/FOO.MD','guide/é.md','guide/é.md','guide/.hidden.md','guide/tail.','guide/raw'];
const targets = ['Target','target','./Target.md','../root','/root','../../root','Note','elsewhere/Note','Report','Report.csv','data','foo','FOO.md','é','é','./Space%20Note.md','Space Note','./Target.md#Heading','./Target.md?x=1#Heading','#Heading','',' missing ','missing.txt','/Missing','./missing','..\\root','\\root','中文/笔记','../中文/笔记.md','Target/../Target','./%ZZ.md','./%E4%B8%AD%E6%96%87.md','./Target.md#A%20B','http://example.com','//example.com','raw','tail.','.hidden'];
const graphs = [paths, paths.filter(p => !p.startsWith('guide/Target')), ['source.md','z/Note.md','ä/Note.md','a/Note.md','A/Note.md','中文/Note.md'], []].map(paths => {
  const documents = paths.map(path => ({path,name:path.split('/').at(-1)}));
  const graph = ts.createMarkdownLinkGraph(documents);
  const cases = [];
  for (const source of ['guide/source.md','guide/nested/source.md','source.md','GUIDE/SOURCE.MD']) for (const target of targets) {
    for (const kind of ['wiki','markdown']) {
      if (kind === 'wiki' && /^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // Qualified resource routing is a separate multi-root contract.
      const r = kind === 'wiki' ? graph.resolveWikiLink(source,target) : graph.resolveMarkdownLink(source,target);
      cases.push({source,target,kind,expected:r && {exists:r.exists,ambiguous:r.ambiguous,path:r.path,candidates:r.candidatePaths}});
    }
  }
  return {documents,cases};
});
const headingSources = ['# Hello, **World**!\n\n# Hello, **World**!\n\n中文标题\n---\n', '  ## A [Link](x.md) and ![image](pic.png) ##\n# Café 🐶\n# A_B\n# é\n# A\\B\n# %bad\n', '# Empty\n```md\n# In code\n```\nText\n===\n####### invalid\n', '🐶\n\n### 猫咪\n### 猫咪\n'];
const headings = headingSources.map(source => ({source,positions:[...ts.createMarkdownHeadingIndex(source).positions].map(([key,offset]) => [key,Buffer.byteLength(source.slice(0,offset))])}));
const urls = ['https://example.com/a?x=1&amp;y=2','//example.com','java&#x73;cript:alert(1)','javascript:alert(1)','https://a:b@example.com','mailto:me@example.com','#Hello','note.md','./Space Note.md','Space Note.md','java script:alert(1)','https://example.com/%00','foo&#10;bar','<unsafe>','', 'mailto:', 'http:foo', ' https://example.com '].map(value => ({value,expected:ts.getSafeMarkdownHref(value)}));
const output = JSON.stringify({sourceCommit:receipt.commit,graphs,headings,urls},null,1)+'\n';
if (process.argv.includes('--check')) { if (await readFile(fixturePath,'utf8') !== output) throw Error('Stale navigation oracle'); }
else await writeFile(fixturePath,output);
console.log(`${graphs.reduce((n,g)=>n+g.cases.length,0)} TS resolutions, ${headings.length} heading indexes, ${urls.length} URL policies; ${Object.keys(inputs).length} pinned inputs`);
