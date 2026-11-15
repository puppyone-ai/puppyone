// Execute the reviewed TS implementations; never update their source hashes implicitly.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const receipt = JSON.parse(await readFile(path.join(root, 'fixtures/test-parity-reference.json'), 'utf8'));
const reference = path.resolve(root, process.env.PUPPYONE_PARITY_ROOT ?? receipt.checkout);
for (const [file, expected] of Object.entries(receipt.inputs)) {
  const hash = createHash('sha256').update(await readFile(path.join(reference, file))).digest('hex');
  if (hash !== expected) throw Error(`Reviewed TS acceptance input drift: ${file}; review before repinning`);
}
const {build} = await import(pathToFileURL(path.join(reference, 'node_modules/esbuild/lib/main.js')));
const bundle = await build({entryPoints:[path.join(reference,'src/shared-ui/editor/document-session/autoSavePolicy.ts')],bundle:true,write:false,platform:'node',format:'esm'});
const ts = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const real = {setTimeout, clearTimeout, now: Date.now};
const autoSave = [];
try {
  let now = 0, serial = 0;
  const timers = new Map();
  globalThis.setTimeout = (fn, delay) => { const id = ++serial; timers.set(id, {at:now + delay, fn}); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  Date.now = () => now;
  const fired = [];
  const scheduler = ts.createIdleAutoSaveScheduler(() => fired.push(now));
  function step(action, ms = 0) {
    if (action === 'advance') {
      const until = now + ms;
      for (;;) {
        const next = [...timers].sort((a,b) => a[1].at-b[1].at)[0];
        if (!next || next[1].at > until) break;
        timers.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = until;
    } else scheduler[action]();
    autoSave.push({action,ms,at:now,saved:[...fired]});
  }
  step('flush'); step('schedule'); step('advance',700); step('schedule');
  step('advance',799); step('advance',1); step('advance',4000);
  for (let n=0;n<40;n++) { step('schedule'); step('advance',50); }
  step('schedule'); step('flush'); step('schedule'); step('cancel'); step('advance',5000);
  let seed = 7823;
  const next = n => { seed=(1664525*seed+1013904223)>>>0; return (seed>>>8)%n; };
  for (let n=0;n<500;n++) {
    const action = ['schedule','schedule','schedule','advance','flush','cancel'][next(6)];
    step(action, action === 'advance' ? next(2200) : 0);
  }
  step('advance',5000);
} finally {
  globalThis.setTimeout=real.setTimeout; globalThis.clearTimeout=real.clearTimeout; Date.now=real.now;
}
const {readCloudWorkspaceEvents} = await import(pathToFileURL(path.join(reference,'electron/main/cloud-workspace-events.mjs')));
const eventCases = [];
const hints = [undefined, null, [], ['a.md'], ['docs/你好😀.md','a.md','a.md'], ['../a'], ['/a'], ['a//b'], ['a/./b'], ['a/../b'], ['a/'], ['a\\b'], ['a\0b'], [1], [''], ['😀'.repeat(2048)], ['😀'.repeat(2049)], Array.from({length:256},(_,i)=>`doc${i}`), Array.from({length:257},(_,i)=>`doc${i}`)];
for (const reset of [undefined, false, true]) for (const paths of hints) {
  const value = {generation:'one',reset,paths};
  const frame = `event: change\ndata: ${JSON.stringify(value)}\n\n`;
  const events=[];
  let valid=true;
  const response = new Response(new ReadableStream({start(controller) { controller.enqueue(new TextEncoder().encode(frame)); controller.close(); }}), {headers:{'content-type':'text/event-stream'}});
  try { await readCloudWorkspaceEvents(response, event => events.push(event.paths ?? null)); }
  catch(error) { if (error.message !== 'Cloud file connection closed.') valid=false; }
  eventCases.push({frame,valid,events});
}
const output = JSON.stringify({sourceCommit:receipt.commit,autoSave,eventCases},null,1)+'\n';
const file = path.join(root,'fixtures/test-parity-oracle.json');
if(process.argv.includes('--check')) { if(await readFile(file,'utf8') !== output) throw Error('Stale TS acceptance oracle'); }
else await writeFile(file,output);
console.log(`${autoSave.length} TS scheduler transitions and ${eventCases.length} TS event cases verified`);
