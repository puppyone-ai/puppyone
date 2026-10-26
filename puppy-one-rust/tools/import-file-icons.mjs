// node tools/import-file-icons.mjs [product checkout] [--check]
// Compile the actual TS theme registry into parameterized glyphs, not 18px
// screenshots. Classification, ink and coverage remain separate contracts.
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {importProductModule,productRoot,root} from './product-bundle.mjs';
const product=await productRoot(process.argv[2]?.startsWith('--')?undefined:process.argv[2]);
const check=process.argv.includes('--check');
const ts=createRequire(path.join(product,'package.json'))('typescript');
const registryPath='packages/shared-ui/src/file/icon-themes/registry.ts';
const parsed=ts.createSourceFile(registryPath,await readFile(path.join(product,registryPath),'utf8'),ts.ScriptTarget.Latest,true);
let retired;
function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(parsed)==='RETIRED_FILE_ICON_THEME_IDS')retired=node.initializer.getText(parsed);ts.forEachChild(node,visit);}visit(parsed);
if(!retired)throw Error('Missing retired-theme migration authority');
const bundle=await importProductModule(product,`
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {FileGlyphIcon,FILE_ICON_THEMES} from './packages/shared-ui/src/file/fileIcons';
import {FILE_FORMATS,FILE_SEMANTIC_KINDS,getFileSemanticKind} from './packages/shared-ui/src/core/fileFormats';
import {getFileIconThemeDefinition} from './packages/shared-ui/src/file/icon-themes/registry';
export const retired=${retired};
export const defaultTheme=getFileIconThemeDefinition(null).id;
export const themes=FILE_ICON_THEMES.map(t=>t.id);export const kinds=[...FILE_SEMANTIC_KINDS];
export function render(theme,kind,size){return renderToStaticMarkup(<FileGlyphIcon name="x.qqqq" type={kind} size={size} theme={theme}/>);}
const samples=FILE_FORMATS.flatMap(f=>[...(f.filenames??[]).map(name=>({name})),...(f.extensions??[]).map(ext=>({name:'sample'+ext})),...(f.mimeTypes??[]).map(mime=>({name:'x.unknown',mime}))]);
samples.push({name:'unknown.zzz'},...FILE_SEMANTIC_KINDS.map(type=>({name:'unknown.zzz',type})),{name:'README.md',type:'image'},{name:'data.csv',type:'excel'});
export const classification=samples.map(s=>({...s,kind:getFileSemanticKind(s.name,s.type,s.mime)}));
`);
const sizes=[1,9,10,12,13,14,15,16,17,18,20,24,32,56];
const strokeValues=svg=>[...svg.matchAll(/stroke-width="([^"]+)"/g)].map(m=>Number(m[1]));
const round=x=>Number(x.toFixed(3));
const oracle=[];const themes={};
for(const theme of bundle.themes){
 const glyphs={};
 for(const kind of bundle.kinds){
  const raw=sizes.map(size=>bundle.render(theme,kind,size).replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" '));
  const values=raw.map(strokeValues);
  const viewbox=Number(raw[0].match(/viewBox="[^"]+"/)[0].split(/\s+/).at(-2));
  if(!Number.isFinite(viewbox))throw Error('Invalid viewBox');
  const strokes=values[0].map((v,i)=>{
   const candidates=[{mode:'constant',value:v},{mode:'line',value:v},{mode:'multiplied',value:v/viewbox}];
   function evalAt(c,size){const denom=Math.min(18,Math.max(1,size));return c.mode==='constant'?c.value:c.mode==='line'?round(c.value/denom):round(viewbox/denom)*c.value;}
   const policy=candidates.find(c=>sizes.every((s,j)=>Math.abs(evalAt(c,s)-values[j][i])<1e-9));
   if(!policy)throw Error(`Unsupported stroke policy ${theme}/${kind}/${i}; do not silently approximate`);
   return policy;
  });
  function normalize(svg){let i=0;return svg.replace(/(<svg[^>]*\swidth=")[^"]+"/,'$1{size}"').replace(/(<svg[^>]*\sheight=")[^"]+"/,'$1{size}"').replace(/stroke-width="[^"]+"/g,()=>`stroke-width="{stroke${i++}}"`);}
  const normalized=raw.map(normalize);
  if(!normalized.every(s=>s===normalized[0]))throw Error(`Size changes geometry in ${theme}/${kind}; extend the IR`);
  let svg=normalized[0];
  if(svg.includes('<text ')&&svg.includes('QQQQ'))throw Error('Dynamic icon text requires an explicit text renderer, not a frozen outline');
  if(svg.includes('<text '))svg=JSON.parse(execFileSync('python3',[path.join(root,'tools/outline-icon-text.py'),path.join(product,'public/fonts/geist/Geist-Variable.woff2')],{input:JSON.stringify([svg]),encoding:'utf8'}))[0];
  const bindings=[];
  svg=svg.replace(/(fill|stroke|color|stop-color)="([^"]+)"/g,(whole,attr,ink)=>{
   let binding;
   if(ink==='currentColor')binding={token:'currentColor',alpha:1};
   else {const token=ink.match(/^var\(--po-([a-z-]+)\)$/);const mix=ink.match(/^color-mix\(in srgb, var\(--po-([a-z-]+)\) ([\d.]+)%, transparent\)$/);
    if(token)binding={token:token[1],alpha:1};else if(mix)binding={token:mix[1],alpha:Number(mix[2])/100};
   }
   if(!binding){if(ink.includes('var(')||ink.includes('color-mix('))throw Error(`Unsupported ink ${ink}`);return whole;}
   let id=bindings.findIndex(b=>b.token===binding.token&&b.alpha===binding.alpha);
   if(id<0){id=bindings.length;bindings.push(binding);}return `${attr}="{ink${id}}"`;
  });
  if(svg.includes('var(')||svg.includes('<text '))throw Error(`Uncompiled ${theme}/${kind}`);
  glyphs[kind]={svg,viewbox,strokes,bindings};
  sizes.forEach((size,i)=>oracle.push({theme,kind,size,strokes:values[i]}));
 }
 themes[theme]={id:theme,glyphs};
}
const inputs={};
async function hashFile(file){inputs[file]=createHash('sha256').update(await readFile(path.join(product,file))).digest('hex');}
async function walk(dir){for(const f of await readdir(path.join(product,dir),{withFileTypes:true})){const p=`${dir}/${f.name}`;if(f.isDirectory())await walk(p);else if(/\.(tsx?|css)$/.test(p))await hashFile(p);}}
await walk('packages/shared-ui/src/file');
for(const file of ['packages/shared-ui/src/icons/productIcons.tsx','packages/shared-ui/src/core/fileFormats.ts','packages/shared-ui/src/core/fileFormats.json','public/fonts/geist/Geist-Variable.woff2','node_modules/lucide-react/package.json','node_modules/lucide-react/dist/esm/icons/database.js','node_modules/lucide-react/dist/esm/icons/workflow.js'])await hashFile(file);
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:product,encoding:'utf8'}).trim();
async function output(file,value){const target=path.join(root,file),text=JSON.stringify(value,null,1)+'\n';if(check){if(await readFile(target,'utf8')!==text)throw Error(`Stale ${file}`);}else {await mkdir(path.dirname(target),{recursive:true});await writeFile(target,text);}}
await output('assets/file-icons.json',{schema:2,sourceCommit,inputs,kinds:bundle.kinds,order:bundle.themes,defaultTheme:bundle.defaultTheme,retired:bundle.retired,themes});
await output('fixtures/ui/file-icons-oracle.json',{sourceCommit,classification:bundle.classification,cases:oracle});
console.log(`${check?'Verified':'Imported'} ${bundle.themes.length} file-icon themes × ${bundle.kinds.length} kinds; ${oracle.length} size/line cases, ${bundle.classification.length} classifications`);
