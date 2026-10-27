// Execute reviewed, actual TS workbench models. Never repins the source receipt.
// node tools/reference-editor-workbench.mjs [--check]
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const receipt = JSON.parse(await readFile(path.join(root, 'fixtures/editor/workbench-reference.json'), 'utf8'));
const reference = path.resolve(root, receipt.checkout);
for (const [file, expected] of Object.entries(receipt.inputs)) {
  const hash = createHash('sha256').update(await readFile(path.join(reference, file))).digest('hex');
  if (hash !== expected) throw Error(`Reviewed workbench input drift: ${file}; review, do not silently repin`);
}
const {build} = await import(pathToFileURL(path.join(reference, 'node_modules/esbuild/lib/main.js')));
const bundle = await build({entryPoints:[path.join(reference,'packages/shared-ui/src/editor/workbench/editorPaneLayoutModel.ts')],bundle:true,write:false,platform:'node',format:'esm'});
const ts = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const cases = [];
let state = ts.createEditorPaneLayout('a');
function step(op) {
  switch(op.kind) {
    case 'split': state = ts.splitEditorPane(state, op.pane, op.direction, {editorId:op.editor,placement:op.placement}); break;
    case 'move': state = ts.moveEditorPane(state, op.source, op.target, op.direction, op.placement); break;
    case 'focus': state = ts.activateEditorPane(state, op.pane); break;
    case 'assign': state = ts.assignEditorToPane(state, op.pane, op.editor); break;
    case 'close': state = ts.closeEditorPane(state, op.pane); break;
    case 'resize': state = ts.updateEditorSplitRatio(state, op.split, op.ratio); break;
  }
  cases.push({op, expected:state});
}
let random = 1741;
const next = n => { random = (1664525 * random + 1013904223) >>> 0; return (random >>> 8) % n; };
for (let i=0;i<600;i++) {
  const panes = ts.getEditorPanes(state);
  const pane = panes[next(panes.length)].id;
  const direction = next(2) ? 'horizontal' : 'vertical';
  const placement = next(2) ? 'first' : 'second';
  switch (next(6)) {
    case 0: if(panes.length < 12) step({kind:'split',pane,direction,placement,editor:`doc-${i}`}); else step({kind:'close',pane}); break;
    case 1: step({kind:'move',source:pane,target:panes[next(panes.length)].id,direction,placement}); break;
    case 2: step({kind:'focus',pane: next(4) ? pane : 'absent'}); break;
    case 3: step({kind:'assign',pane,editor: next(3) ? `doc-${i}` : null}); break;
    case 4: step({kind:'resize',split:state.root.kind === 'split' ? state.root.id : 'absent',ratio:(next(1800)-400)/1000}); break;
    case 5: step({kind:'close',pane}); break;
  }
}
const operations = new Set(cases.map(c => c.op.kind));
if (operations.size !== 6 || !cases.some(c => c.expected.root.kind === 'split' && (c.expected.root.first.kind === 'split' || c.expected.root.second.kind === 'split'))) throw Error('Oracle lacks recursive/operation coverage');
const output = JSON.stringify({sourceCommit:receipt.commit,cases},null,1)+'\n';
const file = path.join(root,'fixtures/editor/workbench-layout.json');
if(process.argv.includes('--check')) { if(await readFile(file,'utf8') !== output) throw Error('Stale workbench layout oracle'); }
else await writeFile(file,output);
console.log(`${cases.length} actual TS pane transitions verified against ${Object.keys(receipt.inputs).length} pinned working-tree inputs`);
