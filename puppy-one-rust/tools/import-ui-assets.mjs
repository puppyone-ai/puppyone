// node tools/import-ui-assets.mjs [--check]
// Execute the real product registries; no hand-copied icon paths.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {root, productRoot, importProductModule} from './product-bundle.mjs';
const product = await productRoot();
process.env.NODE_ENV = 'production';
const check = process.argv.includes('--check');
const hash = x => createHash('sha256').update(x).digest('hex');
const inputs = {};
async function source(name) {const bytes=await readFile(path.join(product,name)); inputs[name]=hash(bytes); return bytes;}
async function output(name, bytes) {
  const target=path.join(root,name);
  if(check) {
    const actual=await readFile(target).catch(()=>null);
    if(!actual || !actual.equals(Buffer.from(bytes)))throw Error(`Stale ${name}; run node tools/import-ui-assets.mjs`);
  } else {await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
}
const bundle=await importProductModule(product, `
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PRODUCT_ICONS} from './src/shared-ui/icons/productIcons';
import {TestLocalizationProvider} from './src/lib/localization/testing/TestLocalizationProvider';
import {LoadingMark} from './src/shared-ui/primitives/LoadingMark';
const registry=PRODUCT_ICONS;
export const icons=Object.fromEntries(Object.entries(registry).map(([name,Icon])=>[name,renderToStaticMarkup(<Icon size={name==='disclosure'?12:24} strokeWidth={2}/>)]));
export function mark(size,layout){return renderToStaticMarkup(<TestLocalizationProvider><LoadingMark size={size} layout={layout} loadingStyle="rounded" ariaHidden/></TestLocalizationProvider>);}
`);
for(const file of [
  'src/shared-ui/icons/productIcons.tsx',
  'node_modules/lucide-react/package.json','node_modules/lucide-react/dist/esm/icons/folder-closed.js','node_modules/lucide-react/dist/esm/icons/laptop.js',
  'src/shared-ui/styles/product-icons.css', 'src/shared-ui/primitives/LoadingMark.tsx',
  'src/shared-ui/primitives/LoadingPlaceholder.tsx', 'src/shared-ui/styles/loading-mark.css',
  'src/shared-ui/styles/loading-placeholder.css', 'src/components/loading/index.tsx',
])await source(file);
const icons={};
for(const [name,markup] of Object.entries(bundle.icons)) {
  let svg=markup.replaceAll('currentColor','white');
  if(!svg.includes('xmlns='))svg=svg.replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ');
  const stroke=Number(svg.match(/stroke-width="([\d.]+)"/)[1]);
  // Keep masks intact. CloudOff's cutout is 3x the requested stroke; Home
  // owns an optical stroke multiplier. Arbitrary native stroke overrides
  // must respect both, not merely replace the SVG root attribute.
  if(name!=='disclosure')svg=svg.replace(`stroke-width="${stroke}"`,'stroke-width="{stroke}"').replace('stroke-width="6"','stroke-width="{cutout}"');
  icons[name]={svg,strokeScale:name==='disclosure'?1:stroke/2};
}
const geometry={};
for(const size of ['xs','sm','md']) {
  const relay=Object.fromEntries([...bundle.mark(size,'inline').matchAll(/--po-loading-mark-(unit|gap):([\d.]+)px/g)].map(([,k,v])=>[k,Number(v)]));
  geometry[size]={relay,box:Number(bundle.mark(size,'area').match(/--po-loading-mark-box:([\d.]+)px/)[1])};
}
const provenance={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:product,encoding:'utf8'}).trim(),inputs};
await output('assets/ui-assets.json',JSON.stringify({...provenance,icons,loading:{geometry}},null,2)+'\n');
const gallery=[];
for(const [row,size] of [12,16,24].entries())for(const [col,name] of Object.keys(icons).entries())gallery.push({kind:'icon',id:`icon-${name}-${size}`,name,size,stroke:1.65,x:24+col*132,y:20+row*40,w:80,h:32});
const fileIcons=JSON.parse(await readFile(path.join(root,'assets/file-icons.json'),'utf8'));
for(const [themeIndex,theme] of fileIcons.order.entries())for(const [row,[size,ink]] of [[14,'text'],[15,'text'],[18,'text'],[24,'text'],[18,'text-muted'],[18,'accent']].entries())for(const [col,kind] of fileIcons.kinds.entries()) {
  gallery.push({kind:'file',id:`file-${theme}-${kind}-${size}-${ink}`,name:'x.qqqq',nodeType:kind,theme,size,ink,x:24+col*43,y:150+themeIndex*240+row*40,w:38,h:32});
}
let index=0;
for(const layout of ['inline','area'])for(const size of ['xs','sm','md'])for(const tone of ['neutral','info','success','warning','danger']) {
  gallery.push({kind:'mark',id:`rounded-${layout}-${size}-${tone}`,layout,size,tone,x:24+(index%10)*88,y:410+(fileIcons.order.length-1)*240+Math.floor(index/10)*36,w:80,h:32});index++;
}
gallery.push({kind:'placeholder',id:'placeholder-rounded',x:24,y:560+(fileIcons.order.length-1)*240,w:300,h:80,shapes:[{x:8,y:8,width:32,height:32,radius:8},{x:52,y:12,width:200,height:10,radius:5},{x:52,y:30,width:140,height:8,radius:4},{x:8,y:56,width:270,height:10,radius:5}]});
await output('fixtures/ui/asset-gallery.json',JSON.stringify({width:1000,height:690+(fileIcons.order.length-1)*240,items:gallery},null,1)+'\n');
console.log(`${check?'Verified':'Imported'} ${Object.keys(icons).length} product meanings, ${fileIcons.kinds.length} file kinds and rounded loading geometry.`);
