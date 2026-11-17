// The pinned product checkout every Node tool reads (see tools/product_source.py).
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(readFileSync(path.join(root,'product-source.json'),'utf8'));
export const productCommit=config.commit;
export function resolveProductRoot(override){
  const product=path.resolve(root,override??process.env.PUPPYONE_PRODUCT_ROOT??config.checkout);
  if(process.env.PUPPYONE_PRODUCT_UNPINNED!=='1'){
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:product,encoding:'utf8'}).trim();
    if(head!==productCommit) throw new Error(`Product checkout ${product} is at ${head}; product-source.json pins ${productCommit}.`);
  }
  return product;
}
export const productRoot=resolveProductRoot();
// The product's `@puppyone/*` module aliases, read from its vite.config.ts so
// reference bundles resolve the same files the product build does.
export function productAliases(repo=productRoot){
  const config=readFileSync(path.join(repo,'vite.config.ts'),'utf8');
  const alias={};
  for(const m of config.matchAll(/find:\s*"(@puppyone\/[^"]+)",\s*replacement:\s*fileURLToPath\(new URL\("\.\/([^"]+)", import\.meta\.url\)\)/g)) alias[m[1]]=path.join(repo,m[2]);
  if(!alias['@puppyone/shared-ui']||!alias['@puppyone/localization']) throw new Error('Review the product vite.config.ts @puppyone aliases');
  return alias;
}
