// node tools/import-ui-assets.mjs [--check]
// Execute the real product registries; no hand-copied icon paths / Bayer table.
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
import {PRODUCT_ICONS} from './packages/shared-ui/src/icons/productIcons';
export * from './packages/shared-ui/src/primitives/orderedDitherField';
import {TestLocalizationProvider} from './packages/localization/src/testing/TestLocalizationProvider';
import {LoadingMark, LOADING_MARK_DITHER_LIGHT} from './packages/shared-ui/src/primitives/LoadingMark';
export {LOADING_MARK_DITHER_LIGHT};
const registry=PRODUCT_ICONS;
export const icons=Object.fromEntries(Object.entries(registry).map(([name,Icon])=>[name,renderToStaticMarkup(<Icon size={name==='disclosure'?12:24} strokeWidth={2}/>)]));
export function mark(style,size,layout){return renderToStaticMarkup(<TestLocalizationProvider><LoadingMark size={size} layout={layout} loadingStyle={style} ariaHidden/></TestLocalizationProvider>);}
`);
for(const file of [
  'packages/shared-ui/src/icons/productIcons.tsx',
  'node_modules/lucide-react/package.json','node_modules/lucide-react/dist/esm/icons/folder-closed.js','node_modules/lucide-react/dist/esm/icons/laptop.js',
  'packages/shared-ui/src/styles/product-icons.css', 'packages/shared-ui/src/primitives/LoadingMark.tsx',
  'packages/shared-ui/src/primitives/LoadingPlaceholder.tsx', 'packages/shared-ui/src/primitives/orderedDitherField.ts',
  'packages/shared-ui/src/primitives/OrderedDither.tsx', 'packages/shared-ui/src/styles/loading-mark.css',
  'packages/shared-ui/src/styles/loading-placeholder.css', 'src/components/loading/index.tsx',
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
  const props=style=>Object.fromEntries([...bundle.mark(style,size,'inline').matchAll(/--po-loading-mark-(unit|gap):([\d.]+)px/g)].map(([,k,v])=>[k,Number(v)]));
  geometry[size]={relay:props('rounded'),dither:props('dither'),box:Number(bundle.mark('rounded',size,'area').match(/--po-loading-mark-box:([\d.]+)px/)[1])};
}
const locales={};
for(const lang of ['en','zh-Hans','ja','ko','de','fr','es','pt-BR']) {
  const data=JSON.parse((await source(`locales/renderer/${lang}/settings.json`)).toString());
  function flatten(value,prefix=''){for(const [k,v] of Object.entries(value)){const name=prefix?`${prefix}.${k}`:k;if(typeof v==='string'){if(name.includes('loadingStyle.'))locales[lang][name.startsWith('settings.')?name:`settings.${name}`]=v;}else flatten(v,name);}}
  locales[lang]={};flatten(data);
  if(Object.keys(locales[lang]).length!==4)throw Error(`Expected four loading style messages in ${lang}: ${JSON.stringify(locales[lang])}`);
}
const cases=[];
for(const [cols,rows,cell,kind] of [[16,4,1,'mark'],[24,6,1,'mark'],[31,19,2,'placeholder']]) {
  const shapes=kind==='mark'?[0,1,2].map(i=>({x:i*(cols===16?6:9),y:0,width:rows,height:rows,radius:0}))
    :[{x:2,y:2,width:27,height:4,radius:2},{x:2,y:10,width:20,height:7,radius:3}];
  const light=kind==='mark'?bundle.LOADING_MARK_DITHER_LIGHT:bundle.ORDERED_DITHER_LIGHT;
  const mask=bundle.buildOrderedDitherMask(cols,rows,shapes);
  for(const time of [null,0,0.3,0.6,0.9,1.2,1.8,2.8,-0.2]) {
    const pixels=new Uint8ClampedArray(cols*rows*4);
    bundle.paintOrderedDitherFrame(pixels,{cols,rows,mask,ink:[128,140,160,137],light,lightAt:time===null?null:bundle.createOrderedDitherLightField(cols,rows,light)(time)});
    cases.push({cols,rows,cell,shapes,light,time,alpha:[...pixels].filter((_,i)=>i%4===3)});
  }
}
const provenance={sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:product,encoding:'utf8'}).trim(),inputs};
await output('assets/ui-assets.json',JSON.stringify({...provenance,icons,loading:{geometry,markLight:bundle.LOADING_MARK_DITHER_LIGHT,placeholderLight:bundle.ORDERED_DITHER_LIGHT,thresholds:Array.from({length:64},(_,i)=>bundle.orderedDitherThreshold(i%8,Math.floor(i/8))),fps:bundle.ORDERED_DITHER_FPS,cell:bundle.ORDERED_DITHER_CELL_PX},locales},null,2)+'\n');
await output('fixtures/ui/dither-oracle.json',JSON.stringify({sourceCommit:provenance.sourceCommit,cases},null,1)+'\n');
const gallery=[];
for(const [row,size] of [12,16,24].entries())for(const [col,name] of Object.keys(icons).entries())gallery.push({kind:'icon',id:`icon-${name}-${size}`,name,size,stroke:1.65,x:24+col*132,y:20+row*40,w:80,h:32});
const fileIcons=JSON.parse(await readFile(path.join(root,'assets/file-icons.json'),'utf8'));
for(const [themeIndex,theme] of fileIcons.order.entries())for(const [row,[size,ink]] of [[14,'text'],[15,'text'],[18,'text'],[24,'text'],[18,'text-muted'],[18,'accent']].entries())for(const [col,kind] of fileIcons.kinds.entries()) {
  gallery.push({kind:'file',id:`file-${theme}-${kind}-${size}-${ink}`,name:'x.qqqq',nodeType:kind,theme,size,ink,x:24+col*43,y:150+themeIndex*240+row*40,w:38,h:32});
}
let index=0;
for(const style of ['rounded','dither'])for(const layout of ['inline','area'])for(const size of ['xs','sm','md'])for(const tone of ['neutral','info','success','warning','danger']) {
  gallery.push({kind:'mark',id:`${style}-${layout}-${size}-${tone}`,style,layout,size,tone,x:24+(index%10)*88,y:410+(fileIcons.order.length-1)*240+Math.floor(index/10)*36,w:80,h:32});index++;
}
for(const [i,style] of ['rounded','dither'].entries())gallery.push({kind:'placeholder',id:`placeholder-${style}`,style,x:24+i*340,y:670+(fileIcons.order.length-1)*240,w:300,h:80,shapes:[{x:8,y:8,width:32,height:32,radius:8},{x:52,y:12,width:200,height:10,radius:5},{x:52,y:30,width:140,height:8,radius:4},{x:8,y:56,width:270,height:10,radius:5}]});
await output('fixtures/ui/asset-gallery.json',JSON.stringify({width:1000,height:800+(fileIcons.order.length-1)*240,items:gallery},null,1)+'\n');
console.log(`${check?'Verified':'Imported'} ${Object.keys(icons).length} product meanings, ${fileIcons.kinds.length} file kinds, loading geometry and ${cases.length} dither oracle frames.`);
