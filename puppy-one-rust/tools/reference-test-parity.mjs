// Execute the reviewed TS implementations; never update their source hashes implicitly.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
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
const constants = await import(pathToFileURL(path.join(reference, 'shared/agent-contract/constants.mjs')));
const types = await readFile(path.join(reference, 'shared/agent-contract/types.ts'), 'utf8');
function typeBlock(name, next) {
  const start = types.indexOf(`export type ${name}`);
  const end = next ? types.indexOf(next, start) : types.length;
  assert(start >= 0 && end >= start, `Missing TS type ${name}`);
  return types.slice(start, end);
}
const literals = (name, next) => [...typeBlock(name, next).matchAll(/\|\s*"([^"]+)"/g)].map(m => m[1]);
const agentContract = {
  eventTypes: constants.AGENT_EVENT_TYPES,
  readinessCodes: constants.AGENT_READINESS_CODES,
  readinessCodeStatus: constants.AGENT_READINESS_CODE_STATUS,
  sessionOpenErrorCodes: constants.AGENT_SESSION_OPEN_ERROR_CODES,
  capabilities: constants.AGENT_RUNTIME_CAPABILITIES,
  ipcChannels: constants.AGENT_IPC_CHANNELS,
};
assert.deepEqual(literals('AgentEventType', 'AgentCanonicalToolResult'), agentContract.eventTypes);
assert.deepEqual(literals('AgentReadinessCode', 'AgentRuntimeDescriptor'), agentContract.readinessCodes);
assert.deepEqual(literals('AgentSessionOpenErrorCode', 'AgentSessionOpenResult'), agentContract.sessionOpenErrorCodes);
assert.deepEqual([...typeBlock('AgentCapabilities', 'AgentAccountState').matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)].map(m => m[1]), agentContract.capabilities);
assert.deepEqual(literals('AgentIpcChannel', null), agentContract.ipcChannels);
// Keep each transition on one line so a reference update is reviewable.
const output = `{\n "sourceCommit":${JSON.stringify(receipt.commit)},\n "autoSave":[\n${autoSave.map(step=>'  '+JSON.stringify(step)).join(',\n')}\n ],\n "eventCases":[\n${eventCases.map(step=>'  '+JSON.stringify(step)).join(',\n')}\n ],\n "agentContract":${JSON.stringify(agentContract)}\n}\n`;
const file = path.join(root,'fixtures/test-parity-oracle.json');
if(process.argv.includes('--check')) { if(await readFile(file,'utf8') !== output) throw Error('Stale TS acceptance oracle'); }
else await writeFile(file,output);
console.log(`${autoSave.length} TS scheduler transitions and ${eventCases.length} TS event cases verified`);

const {parsePresetViewerManifest} = await import(pathToFileURL(`${reference}/shared/presetViewerManifest.js`));
const {manifestCases} = await import(pathToFileURL(`${reference}/tests/support/editor/preset-manifest-cases.mjs`));
function execute(input, mode) {
  try {
    const manifest = parsePresetViewerManifest(structuredClone(input), mode);
    assert.deepEqual(manifest, {...input, viewers:input.viewers.map(viewer=>({contractVersion:8,...viewer}))});
    assert(Object.isFrozen(manifest)); assert(Object.isFrozen(manifest.viewers));
    for (const viewer of manifest.viewers) for (const value of [viewer,viewer.formatViewerIds,viewer.surfaceTraits,viewer.resourcePolicy,viewer.recoveryPolicy]) assert(Object.isFrozen(value));
    return {accepted:true, value:manifest};
  } catch(error) {
    if (!(error instanceof TypeError)) throw error;
    return {accepted:false, error:error.name, message:error.message};
  }
}
const cases = manifestCases.map(([name,input])=> {
  const main=execute(input,'main'), renderer=execute(input,'renderer');
  assert.equal(main.accepted,renderer.accepted,name);
  if (main.accepted) assert.deepEqual(main.value,renderer.value,name);
  return {name,input,main,renderer};
});
const presetInputs = {};
for (const name of ['shared/presetViewerManifest.js','shared/presetViewerManifest.json','tests/support/editor/preset-manifest-cases.mjs','tests/unit/editor/runtime/presetManifestCharacterization.test.mjs','tests/unit/editor/runtime/__snapshots__/presetManifestCharacterization.test.mjs.snap','electron/main/viewer-packs/preset-viewer-manifest.mjs','src/shared-ui/editor/registry/presetViewerManifest.ts']) presetInputs[name]=createHash('sha256').update(await readFile(`${reference}/${name}`)).digest('hex');
const presetOutput = JSON.stringify({sourceCommit:receipt.commit, inputs:presetInputs, cases})+'\n';
const presetFile = path.join(root, 'fixtures/preset-manifest-oracle.json');
if (process.argv.includes('--check')) {
  if (await readFile(presetFile, 'utf8') !== presetOutput) throw Error('Stale TS preset manifest oracle');
} else await writeFile(presetFile, presetOutput);
console.log(`${cases.length} TS preset manifest cases verified in main and renderer modes`);


// Real TS catalog/advisor behavior, including all 32 product/evidence cases.
const {defaultLocalAgentCatalog: agentCatalog} = await import(pathToFileURL(`${reference}/electron/main/local-agent-catalog/catalog.mjs`));
const {localAgentCapabilities} = await import(pathToFileURL(`${reference}/electron/main/local-agent-catalog/agent-definition.mjs`));
const {setupRegistry} = await import(pathToFileURL(`${reference}/electron/main/local-agent-installation/setup/setup-registry.mjs`));
const {createActivationRegistry} = await import(pathToFileURL(`${reference}/electron/main/local-agent-activation/activation-registry.mjs`));
const {adviseSetup} = await import(pathToFileURL(`${reference}/electron/main/local-agent-installation/setup/setup-advisor.mjs`));
const advice = [];
const baseRequest = {surface:'chat',eligibleInstallationIds:setupRegistry.map(r=>r.id),hiddenAgentIds:[],preferences:{enabled:true,dismissedSetupIds:[],snoozedUntil:{}}};
const allMissing = setupRegistry.map(r=>({agentId:r.id,status:'not-found'}));
const present = setupRegistry.filter(r=>r.companionId).map(r=>({companionId:r.id,status:'present'}));
function characterize(name, overrides={}) {
  const input = {platform:'darwin',request:structuredClone(baseRequest),installations:structuredClone(allMissing),companions:present,now:1000,suppressed:[],...overrides};
  advice.push({name,input:structuredClone(input),expected:adviseSetup({...input,registry:setupRegistry,installations:{results:input.installations},sessionSuppressed:new Set(input.suppressed)})});
}
for (const agent of agentCatalog) for (const status of ['found','not-found','failed','unknown']) {
  const id=agent.installation.id;
  characterize(`${id}/${status}`,{request:{...baseRequest,eligibleInstallationIds:[id]},installations:[{agentId:id,status}],companions:[{companionId:id,status:'present'}]});
}
characterize('completed absence');
for (const status of ['found','failed']) characterize(`all/${status}`,{installations:allMissing.map(o=>({...o,status}))});
characterize('no completed installation evidence',{installations:[]});
for (const reasonCode of ['environment-unavailable','context-error','product-error']) {
  const installations=structuredClone(allMissing);
  Object.assign(installations.find(r=>r.agentId==='hermes'),{status:'failed',reasonCode});
  characterize(reasonCode,{installations});
  installations.find(r=>r.agentId==='codex').status='found';
  characterize(`${reasonCode}/found`,{installations});
}
for (const status of ['not-found','unknown','unsupported']) characterize(`companion/${status}`,{companions:[{companionId:'codex',status}]});
for (const [name,patch] of [['disabled',{preferences:{...baseRequest.preferences,enabled:false}}],['hidden',{hiddenAgentIds:['codex','cursor']}],['dismissed',{preferences:{...baseRequest.preferences,dismissedSetupIds:['codex','cursor']}}],['snoozed',{preferences:{...baseRequest.preferences,snoozedUntil:{codex:1001,cursor:1000}}}]]) characterize(name,{request:{...baseRequest,...patch}});
characterize('session suppressed',{suppressed:['codex','cursor']});
characterize('terminal rejects chat-only routes',{request:{...baseRequest,surface:'terminal'}});
characterize('unknown platform',{platform:'freebsd'});
const capabilities=[];
for (const platform of ['darwin','linux','win32','freebsd']) for (const arch of ['arm64','x64','ia32','riscv64']) {
  capabilities.push({platform,arch,registered:[...createActivationRegistry({platform,arch}).keys()].sort(),agents:agentCatalog.map(agent=>({id:agent.installation.id,...localAgentCapabilities(agent,{platform,arch})}))});
}
const setupOutput=JSON.stringify({sourceCommit:receipt.commit,advice,capabilities})+'\n';
const setupFile=path.join(root,'fixtures/local-agent-setup-oracle.json');
if(process.argv.includes('--check')) { if(await readFile(setupFile,'utf8')!==setupOutput) throw Error('Stale TS Local Agent setup oracle'); }
else await writeFile(setupFile,setupOutput);
console.log(`${advice.length} TS setup evidence cases and ${capabilities.length} platform/architecture combinations verified`);

// Real journal migration and live-schema boundaries, with no installation work.
const {mkdtemp,rm} = await import('node:fs/promises');
const {tmpdir} = await import('node:os');
const {createActivationJournal} = await import(pathToFileURL(`${reference}/electron/main/local-agent-activation/activation-journal.mjs`));
const {assertActivationSnapshot} = await import(pathToFileURL(`${reference}/shared/local-agent-activation/schema.mjs`));
const journalCases=[];
const baseSnapshot={epoch:'fixture',revision:1,operations:[{operationId:'operation-1',setupId:'codex',displayName:'Codex',status:'ready',steps:['prepare','install','verify'].map(id=>({id,status:'complete'})),installed:true,errorCode:null,updatedAt:1}]};
const legacy=()=>({epoch:'old',revision:2,operations:[{operationId:'old-task',setupId:'codex',displayName:'Codex',status:'authentication-required',installed:true,errorCode:null,updatedAt:1,steps:[{id:'prepare',status:'complete'},{id:'install',status:'complete'},{id:'login',status:'running'},{id:'verify',status:'pending'}]}]});
const journalDir=await mkdtemp(path.join(tmpdir(),'puppyone-journal-oracle-'));
try {
  async function journalCase(name,value) {
    const file=path.join(journalDir,'journal.json');
    await writeFile(file,JSON.stringify(value));
    let accepted=false,operations=null;
    try {operations=await createActivationJournal(file).read();accepted=true;} catch {}
    const unchanged=await readFile(file,'utf8')===JSON.stringify(value);assert(unchanged,name);
    let liveAccepted=false;
    try {assertActivationSnapshot(value);liveAccepted=true;} catch {}
    journalCases.push({name,input:value,accepted,operations,liveAccepted});
  }
  await journalCase('v2',{schemaVersion:2,snapshot:baseSnapshot});
  for(const status of ['authentication-required','authenticating','verifying','detected']) {
    const value=legacy();value.operations[0].status=status;await journalCase(`legacy/${status}`,value);
  }
  for(const errorCode of ['authentication','verification']) {
    const value=legacy();Object.assign(value.operations[0],{status:'failed',errorCode});await journalCase(`legacy/${errorCode}`,value);
  }
  {const value=legacy();value.operations[0].installed=false;await journalCase('legacy/not installed',value);}
  {const value=legacy();value.operations[0].status='cancelled';await journalCase('legacy/cancelled',value);}
  for(const kind of ['state','step','extra','version']) {
    let value=legacy();
    if(kind==='state')value.operations[0].status='unknown';
    if(kind==='step')value.operations[0].steps[2].status='unknown';
    if(kind==='extra')value.operations[0].command='unexpected';
    if(kind==='version')value={schemaVersion:3,snapshot:value};
    await journalCase(`legacy/invalid/${kind}`,value);
  }
  async function mutate(name,patch) {
    const snapshot=structuredClone(baseSnapshot);patch(snapshot);
    await journalCase(`live/${name}`,snapshot);
    await journalCase(`v2/${name}`,{schemaVersion:2,snapshot});
  }
  for(const field of ['epoch','revision','operations']) await mutate(`missing/${field}`,s=>delete s[field]);
  await mutate('extra',s=>s.command='unexpected');
  for(const n of [-1,0,1.5,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,null,'1']) {
    await mutate(`revision/${n}`,s=>s.revision=n);
    await mutate(`updatedAt/${n}`,s=>s.operations[0].updatedAt=n);
  }
  for(const value of ['', 'a'.repeat(100),'a'.repeat(101),'../bad','has space','雪','a:b-1',null,1]) {
    await mutate(`epoch/${String(value)}`,s=>s.epoch=value);
    await mutate(`setupId/${String(value)}`,s=>s.operations[0].setupId=value);
    await mutate(`operationId/${String(value)}`,s=>s.operations[0].operationId=value);
  }
  for(const value of ['', 'x'.repeat(100),'x'.repeat(101),'😀'.repeat(50),'😀'.repeat(51),null,3]) await mutate(`name/${String(value)}`,s=>s.operations[0].displayName=value);
  for(const n of [0,16,17]) await mutate(`operations/${n}`,s=>s.operations=Array.from({length:n},(_,i)=>({...structuredClone(baseSnapshot.operations[0]),setupId:`agent-${i}`})));
  await mutate('duplicate setup',s=>s.operations.push(structuredClone(s.operations[0])));
  for(const field of Object.keys(baseSnapshot.operations[0])) await mutate(`operation missing/${field}`,s=>delete s.operations[0][field]);
  await mutate('operation extra',s=>s.operations[0].command='unexpected');
  for(const status of ['preparing','installing','setup-required','verifying','ready','cancelling','cancelled','failed','interrupted','authenticating','unknown']) await mutate(`status/${status}`,s=>s.operations[0].status=status);
  for(const errorCode of ['installation-check','download','integrity','archive','installation-busy','installation','interrupted','storage','timeout','process','unsupported','authentication',{},null]) await mutate(`error/${JSON.stringify(errorCode)}`,s=>s.operations[0].errorCode=errorCode);
  for(const value of [true,false,1,null,'true']) await mutate(`installed/${value}`,s=>s.operations[0].installed=value);
  for(const status of ['pending','running','complete','skipped','failed','unknown',null]) await mutate(`step status/${status}`,s=>s.operations[0].steps[1].status=status);
  await mutate('step order',s=>s.operations[0].steps.reverse());
  await mutate('step extra',s=>s.operations[0].steps[0].command='unexpected');
  await mutate('step missing',s=>delete s.operations[0].steps[0].status);
  await mutate('four live steps',s=>s.operations[0].steps.splice(2,0,{id:'login',status:'running'}));
} finally { await rm(journalDir,{recursive:true,force:true}); }
const journalOutput=JSON.stringify({sourceCommit:receipt.commit,cases:journalCases})+'\n';
const journalFile=path.join(root,'fixtures/activation-journal-oracle.json');
if(process.argv.includes('--check')) {if(await readFile(journalFile,'utf8')!==journalOutput)throw Error('Stale TS activation journal oracle');}
else await writeFile(journalFile,journalOutput);
console.log(`${journalCases.length} TS activation journal and live-schema cases verified`);
