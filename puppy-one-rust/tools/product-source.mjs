import path from 'node:path';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const productRoot=path.resolve(root,process.env.PUPPYONE_PRODUCT_ROOT??JSON.parse(readFileSync(path.join(root,'product-source.json'),'utf8')).checkout);
