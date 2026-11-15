import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';

const root = process.env.PUPPYONE_PARITY_ROOT;
assert(root, 'PUPPYONE_PARITY_ROOT is required');
const from = (relative) => import(pathToFileURL(path.join(root, relative)));
const {requestCloudApi} = await from('electron/main/cloud-api-client.mjs');
const {createRemoteHostClient} = await from('electron/main/hosts/remote-host-client.mjs');
const {createHostSshClient} = await from('electron/main/hosts/ssh/host-ssh-client.mjs');
const readSecret = async (name, fallback) => JSON.parse(await fs.readFile(process.env[name] || path.join(os.homedir(), '.secrets', fallback), 'utf8'));
const account = await readSecret('ACCEPT_ACCOUNT_FILE', 'qubits-e2e-colleague.json');
const supabase = await readSecret('ACCEPT_SUPABASE_FILE', 'qubits-supabase-public.json');
const apiBase = process.env.ACCEPT_API || 'https://qubits-api.puppyone.ai/api/v1';
const response = await fetch(`${supabase.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
 method: 'POST', headers: {apikey:supabase.SUPABASE_ANON_KEY,'Content-Type':'application/json'},
 body:JSON.stringify({email:account.email,password:account.password}), signal:AbortSignal.timeout(60000),
});
assert(response.ok, `Sign-in failed (${response.status})`);
const grant = await response.json();
assert(grant.access_token && grant.user?.id, 'Sign-in missing identity');
const expected = {userId:grant.user.id,generation:'interop-accept'};
const api = (base, route, init={}) => requestCloudApi(base, route, {...init, headers:{...init.headers,Authorization:`Bearer ${grant.access_token}`},signal:AbortSignal.timeout(60000)});
const auth = {
 requestSessionApi:api,
 async openHostTunnelSocket(_base,url,_expected,WebSocketImpl=globalThis.WebSocket) {
  return new WebSocketImpl(url,['version.v1',`version.bearer.${grant.access_token}`]);
 },
};
const logger={warn(){},error(){},info(){}};
if (process.argv[2] !== '--host') {
 const folderId=process.argv[2]; assert(folderId,'folder ID required');
 const ssh=createHostSshClient({auth,apiBase,logger});
 const remote=createRemoteHostClient({auth,apiBase,ssh});
 const request=async (input)=>{const reply=await remote.request(folderId,input,expected);assert.equal(reply.ok,true,JSON.stringify(reply));return reply.result;};
 try {
  const read=await request({action:'read',path:'note.md'});
  const text=Buffer.from(read.content_base64,'base64').toString('utf8');
  assert.equal(text,'shared by the Rust host\n');
  const list=await request({action:'list',path:''});assert(list.entries.some(e=>e.name==='note.md'));
  await request({action:'write',path:'note.md',content_base64:Buffer.from('written by the TypeScript access side\n').toString('base64'),expected_revision:read.revision});
  const saved=await request({action:'read',path:'note.md'});
  assert.equal(Buffer.from(saved.content_base64,'base64').toString(),'written by the TypeScript access side\n');
  const conflict=await remote.request(folderId,{action:'write',path:'note.md',content_base64:Buffer.from('stale').toString('base64'),expected_revision:read.revision},expected);
  assert.equal(conflict.ok,false);assert.equal(conflict.status,409);
  for (const input of [{action:'read',path:'../outside'},{action:'git',op:'status'}]) {
   const denied=await remote.request(folderId,input,expected);assert.equal(denied.ok,false);
  }
  console.log(JSON.stringify({ok:true,text,checks:['read','list','write','readback','conflict','traversal','unconsented-git']}));
 } finally {ssh.closeAll();}
} else {
 const binary=process.argv[3];assert(binary,'Rust test binary required');
 const {runHostService}=await from('electron/host-service/runtime.mjs');
 const {connectControlClient}=await from('electron/host-service/control.mjs');
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'puppyone-ts-rust-interop-'));
 const stateDir=path.join(temporary,'state'),folderRoot=path.join(temporary,'folder');
 await fs.mkdir(folderRoot);await fs.writeFile(path.join(folderRoot,'note.md'),'shared by the TypeScript host\n');
 // Test-only secure-storage adapter; all protocol/file/SSH behavior is production code.
 const secureStorage={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'accept-test',encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
 let host,desktop,deviceId;
 try {
  host=await runHostService({stateDir,secureStorage,appVersion:'0.0.0-interop',appDataDirs:[stateDir],logger});
  desktop=await connectControlClient({stateDir,role:'desktop',logger,handlers:{
   session:async()=>({user_id:grant.user.id,api_base_url:apiBase,session_generation:expected.generation}),
   api:async({base,route,init})=>{assert.equal(base,apiBase);return api(base,route,init);},
  }});
  await desktop.call('configure',{apiBase});
  const owner=await desktop.call('identityRegister',{name:'TS Rust interop acceptance',platform:process.platform,expectedSession:expected});deviceId=owner.deviceId;
  const shared=await desktop.call('registryRegister',{deviceId,rootPath:folderRoot,name:'interop',writable:true,expectedSession:expected});
  await desktop.call('connect',{accountId:owner.accountId,deviceId});
  const deadline=Date.now()+30000;
  while ((await desktop.call('status')).state!=='online') {assert(Date.now()<deadline,'TS Host did not go online');await delay(200);}
  const name='workspace::hosts::acceptance::a_folder_a_typescript_host_shares_opens_here';
  const {stdout,stderr}=await promisify(execFile)(binary,[name,'--exact','--ignored','--nocapture','--test-threads=1'],{env:{...process.env,ACCEPT_INTEROP_FOLDER:shared.folderId},timeout:300000,maxBuffer:2*1024*1024});
  assert(stdout.includes(`test ${name} ... ok`),stdout+stderr);assert(stdout.includes('1 passed; 0 failed; 0 ignored;'),stdout);
  assert.equal(await fs.readFile(path.join(folderRoot,'note.md'),'utf8'),'written by the Rust access side\n');
  console.log(JSON.stringify({ok:true,direction:'TS Host to Rust access',checks:['real-production-host','cloud-tunnel','ssh','list','read','write','readback','conflict','traversal','unconsented-git']}));
 } finally {
  const errors=[];
  if(desktop) {try {await desktop.call('stopSharing');}catch(e){errors.push(e);}desktop.close();}
  if(host) {try{await host.close();}catch(e){errors.push(e);}}
  if(deviceId) {try{await api(apiBase,`/hosts/devices/${deviceId}`,{method:'DELETE'});}catch(e){errors.push(e);}}
  await fs.rm(temporary,{recursive:true,force:true});
  assert.equal(errors.length,0,'TS Host cleanup failed');
 }
}
