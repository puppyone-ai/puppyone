// An isolated process around the actual pinned TS installer. Only transport and
// the external CLI version check use fixtures; leases/extraction/commit are real.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const [reference, file] = process.argv.slice(2);
const config = JSON.parse(await fs.readFile(file, 'utf8'));
assert((await fs.stat(path.join(config.home, '.interop-fixture'))).isFile());
const {createManagedArtifactInstaller} = await import(pathToFileURL(path.join(reference,
  'electron/main/local-agent-activation/managed-artifact-installer.mjs')));
let downloads = 0, commits = 0;
const cancellation = new AbortController();
const installer = createManagedArtifactInstaller({homedir: config.home, download: async (_artifact, destination, {signal}) => {
  downloads++;
  await fs.writeFile(path.join(config.control, 'ready'), 'ready');
  const deadline = Date.now() + 20_000;
  while (config.hold) {
    if (await exists('cancel')) cancellation.abort(Object.assign(new Error('fixture cancellation'), {code: 'interrupted'}));
    signal.throwIfAborted();
    if (await exists('release')) break;
    assert(Date.now() < deadline, 'fixture release timed out');
    await delay(10);
  }
  await fs.copyFile(config.archive, destination);
}});
async function exists(name) {
  try {await fs.stat(path.join(config.control, name)); return true;}
  catch (error) {if (error.code === 'ENOENT') return false; throw error;}
}
const recipe = {setupId: 'codex', version: 'interop-1', entry: 'codex', binary: 'codex',
  artifact: {url: 'https://registry.npmjs.org/interop-fixture.tgz', algorithm: 'sha512', digest: 'interop-fixture-digest'}};
let status = 'installed';
try {
  await installer.install(recipe, {signal: cancellation.signal,
    verify: async file => assert.equal(await fs.readFile(file, 'utf8'), 'fixture binary'),
    committed: () => commits++});
} catch (error) {status = error.code ?? 'unexpected-error';}
console.log(JSON.stringify({status, downloads, commits}));
