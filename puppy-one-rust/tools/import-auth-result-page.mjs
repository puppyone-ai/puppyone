// The browser page Desktop serves at the end of a sign-in
// (`electron/main/auth/loopback-callback-{copy,server}.mjs`): its copy in the
// eight production locales, the brand mark it carries inline, and the Geist
// face it embeds (public/fonts/geist, OFL; see assets/Geist-OFL.txt).
// `--check` fails when assets/auth/result-page.json is stale.
import path from 'node:path';
import {readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {productRoot, productCommit} from './product-source.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const auth=path.join(productRoot,'electron/main/auth');
const {PAGE_COPY}=await import(pathToFileURL(path.join(auth,'loopback-callback-copy.mjs')).href);
const server=readFileSync(path.join(auth,'loopback-callback-server.mjs'),'utf8');
const mark=/const BRAND_MARK = `([\s\S]*?)`;/.exec(server);
if(!mark) throw new Error('Review the BRAND_MARK in loopback-callback-server.mjs');
const results=['success','unrecognized','notReady','alreadyUsed','stateMismatch','failed'];
for(const [locale,copy] of Object.entries(PAGE_COPY)){
  for(const key of results) if(!Array.isArray(copy[key])||copy[key].length!==3) throw new Error(`${locale}.${key}`);
  for(const key of ['returnButton','openAppManually']) if(typeof copy[key]!=='string') throw new Error(`${locale}.${key}`);
}
const out=path.join(root,'assets/auth/result-page.json');
const content=JSON.stringify({sourceCommit:productCommit,brandMark:mark[1],copy:PAGE_COPY},null,1)+'\n';
const font=path.join(productRoot,'public/fonts/geist/Geist-Variable.woff2');
const fontOut=path.join(root,'assets/auth/Geist-Variable.woff2');
if(process.argv.includes('--check')){
  if(readFileSync(out,'utf8')!==content) throw new Error('Stale assets/auth/result-page.json');
  if(!readFileSync(font).equals(readFileSync(fontOut))) throw new Error('Stale assets/auth/Geist-Variable.woff2');
  console.log('Sign-in result page copy verified');
}else{
  writeFileSync(out,content);
  copyFileSync(font,fontOut);
  console.log('Sign-in result page copy imported');
}
