import { normalizeCloudApiBaseUrl } from "../../shared/cloudEndpoint.js";
import { normalizeRelativePath } from "../../local-api/files/path-policy.mjs";
import { databaseError } from "../../shared/database-preview/contract.mjs";
import { REPOSITORY_TARGET_CONTRACT_HEADER, REPOSITORY_TARGET_CONTRACT_VERSION } from "../../shared/repositoryContract.js";

export function validateCloudPreviewUrl(input, value) {
  const apiBaseUrl=normalizeCloudApiBaseUrl(input?.apiBaseUrl);
  if (!apiBaseUrl || typeof input.projectId !== 'string' || !input.projectId || input.projectId.length>200
    || typeof input.path !== 'string' || input.path.length>4096) throw databaseError('invalid-request');
  const relative=normalizeRelativePath(input.path);
  const base=new URL(apiBaseUrl), url=new URL(value,`${base.href}/`);
  if (!relative || url.origin!==base.origin || url.username || url.password || url.hash
    || url.pathname!==`${base.pathname.replace(/\/$/,'')}/content/${encodeURIComponent(input.projectId)}/inline`
    || url.searchParams.get('path')!==relative || !url.searchParams.get('token')) throw databaseError('permission-denied');
  return url.href;
}
function matches(session,input) {
  return !!session && typeof input?.expectedSession?.userId==='string' && typeof input?.expectedSession?.generation==='string'
    && session.user_id===input.expectedSession.userId
    && session.session_generation===input.expectedSession.generation
    && normalizeCloudApiBaseUrl(session.api_base_url)===normalizeCloudApiBaseUrl(input.apiBaseUrl);
}
function requestUrl(value) {try {const url=new URL(value);url.hash='';return url.href;} catch{return null;}}

/** Exact bearer resources already signed by the authenticated provider. PDF
 * network policy admits only retained URLs, never an origin-wide HTTPS rule. */
export function createCloudPreviewResourceService({auth,now=Date.now}) {
  const entries=new Map();
  const retiredOwners=new Set();
  const key=(owner,url)=>JSON.stringify([owner,url]);
  const service={
    async retain(owner,input) {
      if (!Number.isSafeInteger(owner) || owner<=0 || retiredOwners.has(owner) || !matches(await auth.readSession(),input)) throw databaseError('permission-denied');
      const apiBaseUrl=normalizeCloudApiBaseUrl(input.apiBaseUrl), relative=normalizeRelativePath(input.path);
      validateCloudPreviewUrl(input,`${apiBaseUrl}/content/${encodeURIComponent(input.projectId)}/inline?path=${encodeURIComponent(relative)}&token=validation`);
      // Sign through native auth; never accept a renderer's remembered URL
      // from a previous account or session.
      const signed=await auth.requestSessionApi(apiBaseUrl,`/content/${encodeURIComponent(input.projectId)}/inline/sign`,{
        method:'POST',headers:{'Content-Type':'application/json',[REPOSITORY_TARGET_CONTRACT_HEADER]:REPOSITORY_TARGET_CONTRACT_VERSION},
        body:JSON.stringify({path:relative}),
      },input.expectedSession);
      if(retiredOwners.has(owner)||!matches(await auth.readSession(),input)) throw databaseError('permission-denied');
      const url=validateCloudPreviewUrl(input,signed.url), identity=key(owner,url);
      const existing=entries.get(identity);
      if(existing){existing.refs++;existing.deadline=now()+60*60*1000;return {url};}
      for(const [id,entry] of entries) if(entry.deadline<now()) entries.delete(id);
      if(entries.size>=4096 || [...entries.values()].filter(entry=>entry.owner===owner).length>=1024) throw databaseError('budget-exceeded');
      entries.set(identity,{owner,url,input,refs:1,deadline:now()+60*60*1000});return {url};
    },
    revoke(owner,url) {const identity=key(owner,url),entry=entries.get(identity);if(!entry)return;
      if(--entry.refs===0)entries.delete(identity);},
    revokeOwner(owner) {retiredOwners.add(owner);for(const [id,entry] of entries)if(entry.owner===owner)entries.delete(id);},
    reconcileSession(session) {for(const [id,entry] of entries)if(!matches(session,entry.input))entries.delete(id);},
    allowed(value) {const url=requestUrl(value);return [...entries.values()].some(entry=>entry.url===url
      && /\.pdf$/i.test(entry.input.path) && entry.deadline>=now());},
  };
  return service;
}
export function registerCloudPreviewResourceIpc(ipcMain,service) {
  ipcMain.handle('cloud-preview:retain-resource',(event,input)=>service.retain(event.sender.id,input));
  ipcMain.handle('cloud-preview:revoke-resource',(event,input)=>service.revoke(event.sender.id,input?.url));
}
