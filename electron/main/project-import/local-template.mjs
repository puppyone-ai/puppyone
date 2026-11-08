import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import yauzl from 'yauzl';
import { requireRelativeTemplatePath, validateTemplatePlan } from '../../local-api/templates/materialize.mjs';

export const LOCAL_SOURCE_TEMPLATE_EXTENSION = '.puppyonetemplate';
const MAX_BYTES = 32 * 1024 * 1024;
const invalid = () => new Error('Invalid puppyone source template. Download a fresh copy.');

/** Local packages are self-contained. Their hashes prove consistency, not publisher identity. */
export async function parseLocalSourceTemplate(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) throw invalid();
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value)));
  if (zip.entryCount < 2 || zip.entryCount > 1024) { zip.close(); throw invalid(); }
  const entries = await new Promise((resolve, reject) => {
    const files = new Map(); const paths = new Set(); let total = 0; let stopped = false;
    const fail = () => { if (!stopped) { stopped = true; zip.close(); reject(invalid()); } };
    zip.on('error', fail); zip.on('end', () => resolve(files));
    zip.on('entry', entry => { void (async () => {
      if (stopped) return;
      const name = entry.fileName;
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (entry.isEncrypted() || paths.has(name) || (mode && ![0o100000, 0o040000].includes(mode))) throw invalid();
      paths.add(name);
      if (name.endsWith('/')) {
        if (mode && mode !== 0o040000) throw invalid();
        if (name !== 'content/') { if (!name.startsWith('content/')) throw invalid(); requireRelativeTemplatePath(name.slice(8, -1)); }
        zip.readEntry(); return;
      }
      if (mode === 0o040000) throw invalid();
      if (name !== 'manifest.json') {
        if (!name.startsWith('content/')) throw invalid();
        requireRelativeTemplatePath(name.slice(8));
        if (name.split('/').some(part => /^(?:\.git|\.aws|\.ssh|\.env(?:\..*)?|node_modules)$/i.test(part))) throw invalid();
      }
      const limit = name === 'manifest.json' ? 512 * 1024 : MAX_BYTES;
      if (entry.uncompressedSize > limit || files.size >= 257) throw invalid();
      const stream = await new Promise((res, rej) => zip.openReadStream(entry, (error, value) => error ? rej(error) : res(value)));
      const chunks = []; let size = 0;
      for await (const chunk of stream) { size += chunk.length; total += chunk.length; if (size > limit || total > MAX_BYTES + 512 * 1024) { stream.destroy(); throw invalid(); } chunks.push(chunk); }
      files.set(name, Buffer.concat(chunks));
      if (!stopped) zip.readEntry();
    })().catch(fail); });
    zip.readEntry();
  });
  let manifest;
  try { manifest = JSON.parse(entries.get('manifest.json')?.toString('utf8')); } catch { throw invalid(); }
  if (!manifest || Object.keys(manifest).some(key => !['type', 'version', 'name', 'entry', 'workflow', 'files'].includes(key))
    || manifest.type !== 'puppyone.template' || manifest.version !== 1 || typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 120
    || (manifest.workflow !== undefined && (!manifest.workflow || Object.keys(manifest.workflow).some(key => !['kind', 'provider'].includes(key))
      || manifest.workflow.kind !== 'import-source' || manifest.workflow.provider !== 'notion'))
    || !Array.isArray(manifest.files) || manifest.files.length < 1 || entries.size !== manifest.files.length + 1) throw invalid();
  const files = manifest.files.map(file => {
    requireRelativeTemplatePath(file.path);
    const content = entries.get('content/' + file.path);
    if (!content || Object.keys(file).some(key => !['path', 'size', 'sha256'].includes(key)) || content.length !== file.size
      || !/^[a-f0-9]{64}$/.test(file.sha256) || createHash('sha256').update(content).digest('hex') !== file.sha256) throw invalid();
    return { path: file.path, content };
  });
  const entry = manifest.entry ?? 'README.md';
  validateTemplatePlan({ files, initialOpenPath: entry });
  return { name: manifest.name, provider: manifest.workflow?.provider ?? null, workflow: manifest.workflow ?? null, entry, files };
}
export async function readLocalSourceTemplate(filePath) {
  if (!filePath.toLowerCase().endsWith(LOCAL_SOURCE_TEMPLATE_EXTENSION)) throw invalid();
  const before = await fs.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_BYTES) throw invalid();
  const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES || stat.dev !== before.dev || stat.ino !== before.ino) throw invalid();
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) { const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset); if (!bytesRead) throw invalid(); offset += bytesRead; }
    return await parseLocalSourceTemplate(bytes);
  } finally { await handle.close(); }
}
