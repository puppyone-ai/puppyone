// Evaluate the frozen product's own URL classifier and repository parser.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const receipt = JSON.parse(await readFile(path.join(root, 'fixtures/test-parity-reference.json')));
const reference = path.resolve(root, process.env.PUPPYONE_PARITY_ROOT ?? receipt.checkout);
const inputs = ['src/components/OnboardingImportDialog.tsx', 'electron/main/project-entry-service.mjs'];
for (const file of inputs) {
  if (createHash('sha256').update(await readFile(path.join(reference, file))).digest('hex') !== receipt.inputs[file]) throw Error(`Unreviewed source: ${file}`);
}
// Extract these pure functions, excluding the I/O adapters imported by the module.
const source = await readFile(path.join(reference, inputs[1]), 'utf8');
const required = ['requireProjectName', 'requireGitRepository', 'buildRepositoryResult', 'requireRepositoryName', 'getProviderForHost', 'getProviderLabel', 'invalidRepositoryUrl', 'projectEntryError'];
function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw Error(`Missing function ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const constants = source.split('\n').filter(line => /^const (PROJECT_NAME_MAX_LENGTH|WINDOWS_RESERVED_NAME) =/.test(line)).join('\n');
const detector = functionSource(await readFile(path.join(reference, inputs[0]), 'utf8'), 'detectRepositoryProvider');
const {transform} = await import(pathToFileURL(path.join(reference, 'node_modules/esbuild/lib/main.js')));
const program = `${constants}\n${required.map(name => functionSource(source, name)).join('\n')}\n${detector}\nexport {requireGitRepository, requireProjectName, detectRepositoryProvider};`;
const compiled = await transform(program, {loader:'ts', format:'esm'});
const oracle = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
const urls = new Set(['', '   ', '--upload-pack=malicious']);
for (const host of ['github.com','gitlab.com']) {
  for (const prefix of ['https://', 'http://', 'git://', 'ssh://', 'ssh://git@', 'git@', 'GIT@', '']) {
    for (const suffix of ['owner/repo.git', 'group/sub/repo.GIT', 'owner/repo.git.git', 'owner/CON', 'owner/trailing.', 'owner/.git', 'owner/..git', 'owner/' + 'n'.repeat(121)]) {
      urls.add(`${prefix}${host}${prefix.toLowerCase() === 'git@' ? ':' : '/'}${suffix}`);
    }
  }
}
for (const value of [
  'https://token@github.com/owner/repo.git','https://github.com/owner/repo/tree/main',
  'https://bitbucket.org/owner/repo.git','https://github.com.evil.test/owner/repo.git',
  'https://evil.test/github.com/owner/repo','https://evilgithub.com/a/b',
  'https://github.com@evil.test/a/b','ftp://github.com/a/b','git@github.com.evil.test:a/b',
  'github.com:owner/repo','github.com','https://GITHUB.COM/Owner/Repo.GIT',
  '  git@GitLab.com:Group/Sub/Repo.GIT  ','git@github.com:a/b//','git@github.com:a//b',
  'https://github.com/a/b?x=1','https://github.com/a/b#main','https://github.com:8443/a/b',
  'ssh://token@github.com/a/b','ssh://git:secret@github.com/a/b','https://github.com/a/%2e%2e/b',
]) urls.add(value);
const cases = [...urls].map(value => {
  let expected = null;
  try { expected = oracle.requireGitRepository(value); } catch {}
  return {value, detected:oracle.detectRepositoryProvider(value), expected};
});
const names = ['', '.', '..', '../escape', 'bad/name', 'CON', 'trailing.', 'Valid project'];
const projectNames = names.map(value => { try { return {value, expected:oracle.requireProjectName(value)}; } catch {return {value, expected:null};} });
const output = JSON.stringify({sourceCommit:receipt.commit, cases, projectNames}, null, 2) + '\n';
const file = path.join(root, 'fixtures/repository-url-oracle.json');
if (process.argv.includes('--check')) {
  if (await readFile(file, 'utf8') !== output) throw Error('Repository URL oracle drift');
} else await writeFile(file, output);
console.log(`${cases.length} repository URL and ${projectNames.length} name outcomes verified`);
