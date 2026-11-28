// Real TS archive bytes and outcomes. Used by reference-test-parity.mjs only
// after its pinned source hashes have been checked.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';

export async function activationArchiveCases(reference) {
  const require = createRequire(path.join(reference, 'package.json'));
  const tar = require('tar');
  const lock = JSON.parse(await readFile(path.join(reference, 'package-lock.json'), 'utf8'));
  assert.equal(require('tar/package.json').version, lock.packages['node_modules/tar'].version);
  const {extractActivationArchive} = await import(pathToFileURL(path.join(reference,
    'electron/main/local-agent-activation/managed-artifact-installer.mjs')));
  const file = (name, data = 'fixture binary') => ({path: name, type: 'File', data});
  const directory = name => ({path: name, type: 'Directory', data: ''});
  const safe = file('package/codex');
  const vectors = [
    ['regular', [directory('package/'), safe]],
    ['old-file', [{...safe, type: 'OldFile'}]],
    ['unicode', [file('package/文件😀')]],
    ['directory-only', [directory('package/')]],
    ['duplicate', [safe, safe]],
    ['two-roots', [safe, file('other/agent')]],
    ['root-file', [file('codex')]],
    ['double-trailing-slash', [safe, directory('package//')]],
    ['empty-archive', []],
    ...['package/../../escape', '/absolute', 'package\\escape', 'package/../escape',
      'package/file:stream', 'package//file', 'package/./file'].map(name => ['unsafe/' + name, [safe, file(name)]]),
    ...['SymbolicLink', 'Link', 'FIFO', 'CharacterDevice', 'BlockDevice'].map(type => [type,
      [safe, {path: 'package/special', type, data: '', linkpath: '../../outside'}]]),
  ];
  function encode(entries) {
    const blocks = [];
    for (const {data, ...entry} of entries) {
      const body = Buffer.from(data);
      const header = new tar.Header({...entry, mode: 0o755, size: body.length, uid: 0, gid: 0, mtime: new Date(0)});
      header.encode();
      blocks.push(header.block, body, Buffer.alloc((512 - body.length % 512) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    return Buffer.concat(blocks);
  }
  const bytes = vectors.flatMap(([name, entries]) => {
    const raw = encode(entries);
    return [{name: `tar/${name}`, bytes: raw}, {name: `gzip/${name}`, bytes: gzipSync(raw)}];
  });
  const valid = encode([safe]);
  const gzip = gzipSync(valid);
  const checksum = Buffer.from(gzip); checksum[checksum.length - 8] ^= 1;
  bytes.push(
    {name: 'corrupt/plain', bytes: Buffer.from('not a tar file')},
    {name: 'corrupt/truncated-body', bytes: valid.subarray(0, 513)},
    {name: 'corrupt/gzip-header', bytes: Buffer.from([0x1f, 0x8b])},
    {name: 'corrupt/gzip-trailer', bytes: gzip.subarray(0, gzip.length - 8)},
    {name: 'corrupt/gzip-checksum', bytes: checksum},
    {name: 'gzip/concatenated-zero-padding', bytes: Buffer.concat([gzip, gzipSync(Buffer.alloc(1024))])},
    {name: 'corrupt/second-gzip-member', bytes: Buffer.concat([gzip, gzipSync(Buffer.alloc(1024)).subarray(0, 15)])},
  );
  const root = await mkdtemp(path.join(tmpdir(), 'puppyone-archive-oracle-'));
  const cases = [];
  async function contents(directory, relative = '') {
    const output = {};
    for (const entry of (await readdir(path.join(directory, relative), {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) Object.assign(output, await contents(directory, name));
      else {assert(entry.isFile(), name); output[name] = (await readFile(path.join(directory, name))).toString('base64');}
    }
    return output;
  }
  try {
    for (const [index, value] of bytes.entries()) {
      // A deliberately unrelated extension also checks signature detection.
      const archive = path.join(root, `archive-${index}.bin`);
      const output = path.join(root, `output-${index}`);
      await writeFile(archive, value.bytes); await mkdir(output);
      let accepted = true;
      try {await extractActivationArchive(archive, output);}
      catch (error) {assert.equal(error.code, 'archive', value.name); accepted = false;}
      const files = await contents(output);
      if (!accepted) assert.deepEqual(await readdir(output), [], value.name);
      cases.push({name: value.name, archive: value.bytes.toString('base64'), accepted, files});
    }
  } finally {await rm(root, {recursive: true, force: true});}
  return cases;
}
