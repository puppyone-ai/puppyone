import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {productRoot} from '../tools/product-source.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)), repo=productRoot;
const read=p=>readFile(path.join(repo,p),'utf8');
await mkdir(path.join(root,'bundle'),{recursive:true});
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
// Resolve the product's installed dependency graph, so CodeMirror, Lezer
// grammars, React and their postinstall patches are byte-for-byte the ones the
// Electron renderer runs (token boundaries and scheduling depend on them).
// Every listed package stays single-instance; the island's own install is
// only a fallback for a package the product checkout does not provide.
const productModules=path.join(repo,'node_modules');
const alias=Object.fromEntries(Object.keys(pkg.dependencies).map(p=>[p,existsSync(path.join(productModules,p))?path.join(productModules,p):path.join(root,'node_modules',p)]));
// The product patches @codemirror/language after install (parse slice budget);
// apply the same, idempotent patch at bundle time.
const {patchCodeMirrorScheduling}=await import(pathToFileURL(path.join(repo,'scripts/patch-codemirror-scheduling.mjs')).href);
const codemirrorScheduling={name:'product-codemirror-scheduling',setup(b){b.onLoad({filter:/@codemirror[\\/]language[\\/]dist[\\/]index\.(js|cjs)$/},async a=>({contents:patchCodeMirrorScheduling(await readFile(a.path,'utf8'),a.path).source,loader:'js'}));}};
alias['@product']=repo;
alias['@puppyone/shared-ui']=path.join(repo,'packages/shared-ui/src/index.ts');
alias['@puppyone/localization/core']=path.join(repo,'packages/localization/src/core/index.ts');
alias['@puppyone/localization/react']=path.join(repo,'packages/localization/src/react/index.ts');
alias['@puppyone/localization']=path.join(repo,'packages/localization/src/index.ts');
const js=await build({absWorkingDir:repo,entryPoints:[path.join(root,'src/editor.js')],bundle:true,format:'esm',target:'safari17',minify:true,jsx:'automatic',
  define:{'process.env.NODE_ENV':'"production"','import.meta.env':JSON.stringify({DEV:false,PROD:true,MODE:'production',BASE_URL:'/'})},
  alias,nodePaths:[productModules,path.join(root,'node_modules')],loader:{'.svg':'dataurl','.png':'dataurl','.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl'},
  plugins:[codemirrorScheduling,{name:'local-product-assets',setup(b){b.onResolve({filter:/^\/(fonts|assets)\//},a=>({path:path.join(repo,'public',a.path)}));}}],
  legalComments:'eof',outfile:path.join(root,'bundle/editor.js'),metafile:true,logLevel:'warning'});
// Consume the product's generated theme projection, not a hand-written palette,
// wrapped in the sub-theme layer exactly as SubThemeStyleHost injects it.
const generatedPath='src/features/themes/builtinSubThemes.generated.ts';
const generated=await read(generatedPath);
const match=generated.match(/const DEFAULT_NEUTRAL_COMPILED_CSS = Object.freeze\((\{[\s\S]*?\n\})\);/);
if(!match)throw new Error('Default-neutral compiled theme not found');
const theme=JSON.parse(match[1]);
// The product's complete renderer stylesheet with its layer order
// (cascade.css), so pane chrome, menus, tooltips and every Viewer resolve
// exactly as in the Electron renderer. Typography variables come from the
// product typography runtime at mount, not from a fixed size here.
const imports=['src/styles/cascade.css','src/styles.css'].map(p=>`@import ${JSON.stringify(path.join(repo,p))};`).join('\n');
// Island-only engine corrections come last and are documented in the file.
const islandCss=await readFile(path.join(root,'src/webkit-parity.css'),'utf8');
const sharedPackage=JSON.parse(await read('packages/shared-ui/package.json'));
const cssAlias={};
for(const [key,value] of Object.entries(sharedPackage.exports??{}))if(key.endsWith('.css')&&typeof value==='string')cssAlias[`@puppyone/shared-ui/${key.slice(2)}`]=path.join(repo,'packages/shared-ui',value);
const css=await build({absWorkingDir:repo,stdin:{contents:imports+'\n@import "katex/dist/katex.min.css";\n'+Object.values(theme).filter(Boolean).map(css=>`@layer sub-theme {\n${css}\n}`).join('\n')+'\nhtml.dark{color-scheme:dark}html:not(.dark){color-scheme:light}\n'+islandCss,loader:'css',resolveDir:root},bundle:true,minify:true,target:'safari17',alias:cssAlias,nodePaths:[productModules,path.join(root,'node_modules')],loader:{'.woff2':'dataurl','.woff':'dataurl','.ttf':'dataurl','.svg':'dataurl','.png':'dataurl'},plugins:[{name:'local-product-assets',setup(b){b.onResolve({filter:/^\/(fonts|assets)\//},a=>({path:path.join(repo,'public',a.path)}));}}],outfile:path.join(root,'bundle/editor.css'),metafile:true});
// Files read outside esbuild's module graph are recorded explicitly.
const islandFiles=['src/webkit-parity.css','src/index.html'].map(p=>path.relative(repo,path.join(root,p)));
const inputs=[...new Set([...Object.keys(js.metafile.inputs),...Object.keys(css.metafile.inputs),generatedPath,...islandFiles])].filter(p=>!p.startsWith('<')&&!p.startsWith('(disabled):'));
const hashes=Object.fromEntries(await Promise.all(inputs.sort().map(async p=>[p,createHash('sha256').update(await readFile(path.resolve(repo,p.split('?')[0]))).digest('hex')])));
await writeFile(path.join(root,'bundle/sources.json'),JSON.stringify({scope:'actual product editor pane chrome + Markdown/CSV/JSON/text Viewers + complete renderer CSS; persistence is the native document session',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),inputs:hashes},null,2)+'\n');
// Notices for exactly the packages that ended up in the bundles.
const packageDirs=new Set();
for(const input of inputs){const m=input.match(/^(.*?node_modules\/(?:@[^/]+\/)?[^/]+)\//);if(m)packageDirs.add(path.resolve(repo,m[1]));}
const notices=[];
for(const dir of [...packageDirs].sort()) {
  const meta=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));
  for(const filename of ['LICENSE','LICENSE.txt','LICENSE.md','license','LICENCE']) {
    try {notices.push(`${meta.name} @ ${meta.version}\n${await readFile(path.join(dir,filename),'utf8')}`);break;}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
for(const license of ['public/fonts/pt-serif/OFL.txt','public/fonts/open-sans/OFL.txt'])notices.push(`${license}\n${await read(license)}`);
notices.push(await readFile(path.join(root,'../assets/Geist-OFL.txt'),'utf8'));
await writeFile(path.join(root,'bundle/THIRD_PARTY.txt'),notices.join('\n\n----------------------------------------\n\n'));
