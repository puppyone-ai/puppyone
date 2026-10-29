// Execute the product's language resolver and its CodeMirror literal search.
import {readFile, writeFile, access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {productRoot} from './product-source.mjs';
const root = path.resolve(import.meta.dirname, '..');
const receiptPath = path.join(root, 'fixtures/editor/code-reference.json');
const fixturePath = path.join(root, 'fixtures/editor/code.json');
const {build} = await import(pathToFileURL(path.join(productRoot, 'node_modules/esbuild/lib/main.js')));
const bundle = await build({stdin:{contents:`export {resolveCodeLanguageKey,loadCodeLanguageExtension} from './packages/shared-ui/src/editor/code/codeLanguageSupport.ts'; export {SearchQuery} from '@codemirror/search'; export {EditorState} from '@codemirror/state'; export {indentUnit} from '@codemirror/language';`,resolveDir:productRoot},absWorkingDir:productRoot,bundle:true,write:false,platform:'node',format:'esm',metafile:true});
const inputs = {};
const productFiles = ['packages/shared-ui/src/editor/viewers/code/CodeMirrorCodeEditor.tsx','packages/shared-ui/src/editor/find/codeMirrorFindAdapter.ts','packages/shared-ui/src/styles/editor/code-editor.css'];
for (const input of [...new Set([...Object.keys(bundle.metafile.inputs).filter(p => p !== '<stdin>'), ...productFiles])].sort()) {
  inputs[input] = createHash('sha256').update(await readFile(path.join(productRoot,input))).digest('hex');
}
let receipt;
if (process.argv.includes('--record')) {
  try { await access(receiptPath); throw Error('Receipt already exists; review drift explicitly'); } catch(e) { if (e.code !== 'ENOENT') throw e; }
  receipt = {checkout:path.relative(root,productRoot),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:productRoot,encoding:'utf8'}).trim(),inputs};
  await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');
} else {
  receipt = JSON.parse(await readFile(receiptPath,'utf8'));
  if (JSON.stringify(receipt.inputs) !== JSON.stringify(inputs)) throw Error('Reviewed code inputs drifted; do not silently repin');
}
const ts = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const names = ['', 'README','file.txt','a.TSX','b.jsx',...['ts','cts','mts','js','cjs','es6','mjs','pac','py','pyi','pyw','pyx','yml','yaml','sh','bash','zsh','toml','sql','css','scss','sass','less','html','htm','xhtml','xml','svg','json','jsonl','rs'].map(e=>'folder/code.'+e)];
const languages = [null,'',' ', ' TS ','js','py','bash','zsh','sh','yml','text','txt','typescript','javascript','python','json','rust','unknown','TSX','jsx','plaintext'];
const languageCases = [];
for (const name of names) for (const language of languages) {
  const expected=ts.resolveCodeLanguageKey(language,name);
  const state=ts.EditorState.create({extensions:await ts.loadCodeLanguageExtension(expected)});
  languageCases.push({name,language,expected,tabSize:state.tabSize,indent:state.facet(ts.indentUnit)});
}
const sources = ['Aa aA aaa','a.b a*b \\n\n', 'Straße STRASSE','Café CAFE\u0301 cafè', 'ﬃ fffi ffi ① 1 Ａ A','İ i i\u0307 I ı','ΟΣ ος ΟΣΟΣ οσος','🐶🐶中文 中 文','é e\u0301 e \u0301','\u1e9b\u0323 s\u0323\u0307'];
const needles = ['', 'aa','a','a.b','\\n','\n','straße','strasse','café','cafe','é','e','\u0301','ffi','f','ff','i','i\u0307','İ','1','A','ΟΣ','ος','οσ','σ','🐶','中文','中','s\u0323\u0307'];
const searches=[];
for (const source of sources) for (const query of needles) {
  const cursor=new ts.SearchQuery({search:query,caseSensitive:false,literal:true}).getCursor(ts.EditorState.create({doc:source}));
  const expected=[];
  if(query) for(let m=cursor.next();!m.done;m=cursor.next()) expected.push([Buffer.byteLength(source.slice(0,m.value.from)),Buffer.byteLength(source.slice(0,m.value.to))]);
  searches.push({source,query,expected});
}
const output=JSON.stringify({sourceCommit:receipt.commit,languageCases,searches},null,1)+'\n';
if(process.argv.includes('--check')) { if(await readFile(fixturePath,'utf8')!==output) throw Error('Stale code oracle'); }
else await writeFile(fixturePath,output);
console.log(`${languageCases.length} language/indent cases, ${searches.length} Unicode search cases; ${Object.keys(inputs).length} pinned inputs`);
