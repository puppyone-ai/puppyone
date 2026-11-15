// Collect the pinned product's actual Vitest cases, including skipped cases
// omitted by `vitest list --json`. Collection does not execute test bodies.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const reference = JSON.parse(await readFile(path.join(root, 'fixtures/test-parity-reference.json'), 'utf8'));
const checkout = path.resolve(root, process.env.PUPPYONE_PARITY_ROOT ?? reference.checkout);
const git = (...args) => execFileSync('git', args, {cwd: checkout});
if (git('rev-parse', 'HEAD').toString().trim() !== reference.commit) throw Error('TS reference commit drift');
// Include source, configuration and fixtures in the immutability check.
const dirty = git('status', '--porcelain', '--untracked-files=no').toString().trim();
if (dirty) throw Error(`TS reference has tracked modifications: ${dirty}`);
const {createVitest, version} = await import(pathToFileURL(path.join(checkout, 'node_modules/vitest/dist/node.js')));
const previous = process.cwd();
process.chdir(checkout);
const vitest = await createVitest('test', {
  config: path.join(checkout, 'tests/config/vitest.config.ts'),
  root: checkout, watch: false, includeTaskLocation: true, reporters: [],
});
try {
  const {testModules, unhandledErrors} = await vitest.collect();
  if (unhandledErrors.length) throw Error(`Collection failed: ${JSON.stringify(unhandledErrors)}`);
  const files = [];
  for (const module of testModules) {
    if (module.state() === 'failed') throw Error(`Collection failed in ${module.moduleId}`);
    const file = path.relative(checkout, module.moduleId);
    const content = await readFile(module.moduleId);
    if (!content.equals(git('show', `${reference.commit}:${file}`))) throw Error(`TS test source drift: ${file}`);
    const cases = [...module.children.allTests()].map(test => ({
      name: test.fullName, location: test.location,
      skipped: test.result().state === 'skipped',
    }));
    files.push({path: file, sha256: createHash('sha256').update(content).digest('hex'), cases});
  }
  files.sort((a,b) => a.path.localeCompare(b.path, 'en'));
  if (!files.length || !files.some(file => file.cases.length)) throw Error('Empty TS collection');
  const output = path.join(root, 'artifacts/test-parity');
  await mkdir(output, {recursive: true});
  await writeFile(path.join(output, 'typescript-cases.json'), JSON.stringify({
    referenceCommit: reference.commit, vitestVersion: version, files,
  }, null, 2) + '\n');
  console.log(`${files.length} files; ${files.reduce((n, f) => n + f.cases.length, 0)} cases; ${files.reduce((n, f) => n + f.cases.filter(c => c.skipped).length, 0)} skipped`);
} finally {
  await vitest.close();
  process.chdir(previous);
}
