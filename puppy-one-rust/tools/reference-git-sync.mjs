// Run the frozen TS test's own case table and production view model. Vitest
// separately checks these same results against its reviewed snapshots.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const receipt = JSON.parse(await readFile(path.join(root, 'fixtures/test-parity-reference.json'), 'utf8'));
const reference = path.resolve(root, process.env.PUPPYONE_PARITY_ROOT ?? receipt.checkout);
const files = [
  'tests/unit/source-control/status/gitSyncState.test.mjs',
  'tests/unit/source-control/status/__snapshots__/gitSyncState.test.mjs.snap',
  'src/features/source-control/viewModel.ts',
  'src/features/source-control/remotes.ts',
];
for (const file of files) {
  const hash = createHash('sha256').update(await readFile(path.join(reference, file))).digest('hex');
  if (hash !== receipt.inputs[file]) throw Error(`Unreviewed Git sync input: ${file}`);
}
const {build} = await import(pathToFileURL(path.join(reference, 'node_modules/esbuild/lib/main.js')));
const result = await build({
  entryPoints: [path.join(reference, files[0])], bundle: true, write: false,
  platform: 'node', format: 'esm', metafile: true, absWorkingDir: reference,
  plugins: [{name: 'capture-reviewed-cases', setup(b) {
    b.onResolve({filter: /^vitest$/}, () => ({path: 'vitest', namespace: 'capture'}));
    b.onLoad({filter: /.*/, namespace: 'capture'}, () => ({contents: `
      let active;
      export const describe = (_name, run) => run();
      export const it = {each: cases => (_name, run) => {
        for (const [name, status, branch = null, config = null] of cases) {
          active = {name, status, branch, config};
          run(name, status, branch, config);
        }
      }};
      export const expect = expected => ({toMatchSnapshot() {
        globalThis.__puppyoneGitSyncCases.push({...active, expected});
      }});
    `}));
  }}],
});
for (const file of Object.keys(result.metafile.inputs).filter(file => !file.includes('node_modules/') && !file.startsWith('capture:'))) {
  const hash = createHash('sha256').update(await readFile(path.join(reference, file))).digest('hex');
  if (hash !== receipt.inputs[file]) throw Error(`Unreviewed transitive Git sync input: ${file}`);
}
globalThis.__puppyoneGitSyncCases = [];
try {
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const cases = globalThis.__puppyoneGitSyncCases;
  if (cases.length !== 82 || new Set(cases.map(c => c.name)).size !== 82) throw Error('Git sync case table changed');
  const output = JSON.stringify({sourceCommit: receipt.commit, cases}, null, 2) + '\n';
  const file = path.join(root, 'fixtures/git-sync-state-oracle.json');
  if (process.argv.includes('--check')) {
    if (await readFile(file, 'utf8') !== output) throw Error('Stale TS Git sync oracle');
  } else await writeFile(file, output);
  console.log(`${cases.length} TS Git sync presentation outcomes verified`);
} finally { delete globalThis.__puppyoneGitSyncCases; }
