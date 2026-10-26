import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import { requireRelativeTemplatePath, validateTemplatePlan } from './materialize.mjs';
import { requireTemplateId } from '../../shared/desktop/template-link.mjs';

export const TEMPLATE_MAX_BYTES = 32 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const sha = content => createHash('sha256').update(content).digest('hex');
const failure = () => new Error('Template package verification failed. Please download it again.');
export function validateDownloadDescriptor(value, expected) {
  if (!value || value.schema_version !== 1 || value.template_id !== expected.id || value.release_id !== expected.releaseId) throw failure();
  requireTemplateId(value.template_id); requireTemplateId(value.release_id);
  for (const field of ['bundle_sha256', 'content_sha256']) if (!HASH.test(value[field])) throw failure();
  validateDescriptorMetadata(value);
  if (value.initial_open_path !== null) requireRelativeTemplatePath(value.initial_open_path);
  return value;
}
export async function parseTemplatePackage(bytes, descriptor) {
  if (bytes.length !== descriptor.bundle_bytes || bytes.length > TEMPLATE_MAX_BYTES || sha(bytes) !== descriptor.bundle_sha256) throw failure();
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value)));
  if (zip.entryCount > 1024 || zip.entryCount < 2) { zip.close(); throw failure(); }
  const entries = await new Promise((resolve, reject) => {
    const files = new Map(); const paths = new Set(); let total = 0; let stopped = false;
    const fail = () => { stopped = true; zip.close(); reject(failure()); };
    zip.on('error', fail); zip.on('end', () => resolve(files));
    zip.on('entry', entry => { void (async () => {
      if (stopped) return;
      const name = entry.fileName;
      if (validateArchiveEntry(entry, paths)) { zip.readEntry(); return; }
      const limit = name === 'manifest.json' ? 512 * 1024 : TEMPLATE_MAX_BYTES;
      if (entry.uncompressedSize > limit || total + entry.uncompressedSize > TEMPLATE_MAX_BYTES + 512 * 1024 || files.size >= 257) throw failure();
      const stream = await new Promise((res, rej) => zip.openReadStream(entry, (error, value) => error ? rej(error) : res(value)));
      const chunks = []; let size = 0;
      for await (const chunk of stream) {
        size += chunk.length; total += chunk.length;
        if (size > limit || total > TEMPLATE_MAX_BYTES + 512 * 1024) { stream.destroy(); throw failure(); }
        chunks.push(chunk);
      }
      files.set(name, Buffer.concat(chunks));
      if (!stopped) zip.readEntry();
    })().catch(fail); });
    zip.readEntry();
  });
  let manifest;
  try { manifest = JSON.parse(entries.get('manifest.json')?.toString('utf8')); } catch { throw failure(); }
  if (!manifest || Object.keys(manifest).some(k => !['format_version', 'template_id', 'release_id', 'created_at', 'content_sha256', 'files'].includes(k))
    || manifest.format_version !== 1 || manifest.template_id !== descriptor.template_id || manifest.release_id !== descriptor.release_id
    || manifest.content_sha256 !== descriptor.content_sha256 || !Array.isArray(manifest.files) || manifest.files.length !== descriptor.file_count
    || entries.size !== manifest.files.length + 1) throw failure();
  const seen = new Set();
  const files = manifest.files.map(file => {
    requireSafeContentPath(file.path);
    const content = entries.get(`content/${file.path}`);
    if (Object.keys(file).some(k => !['path', 'size', 'sha256'].includes(k)) || seen.has(file.path) || !content || !HASH.test(file.sha256)
      || content.length !== file.size || sha(content) !== file.sha256) throw failure();
    seen.add(file.path);
    if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(content.toString('utf8'))) throw failure();
    return { path: file.path, content };
  });
  if (files.reduce((total, file) => total + file.content.length, 0) !== descriptor.total_bytes || contentDigest(files) !== descriptor.content_sha256) throw failure();
  const plan = { files, initialOpenPath: descriptor.initial_open_path, template: {
    sourceId: 'marketplace', id: descriptor.template_id, version: descriptor.version,
    releaseId: descriptor.release_id, resolvedLocale: descriptor.locale,
  } };
  validateTemplatePlan(plan);
  return plan;
}
function requireSafeContentPath(value) {
  requireRelativeTemplatePath(value);
  if (value.split('/').some(p => /^(\.git|\.aws|\.ssh|\.env(?:\..*)?|node_modules|\.DS_Store)$/i.test(p))) throw failure();
}
function contentDigest(files) {
  const hash = createHash('sha256').update('papertrain-template-content-v1\0');
  for (const file of [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))) {
    const name = Buffer.from(file.path); const length = Buffer.alloc(4); const size = Buffer.alloc(8);
    length.writeUInt32BE(name.length); size.writeBigUInt64BE(BigInt(file.content.length));
    hash.update(length).update(name).update(size).update(createHash('sha256').update(file.content).digest());
  }
  return hash.digest('hex');
}

function validateDescriptorMetadata(value) {
  for (const [field, min, max] of [['file_count', 1, 256], ['total_bytes', 0, TEMPLATE_MAX_BYTES], ['bundle_bytes', 1, TEMPLATE_MAX_BYTES]]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < min || value[field] > max) throw failure();
  }
  for (const [field, max] of [['locale', 20], ['version', 80]]) {
    if (typeof value[field] !== 'string' || !value[field].length || value[field].length > max) throw failure();
  }
  const expires = Date.parse(value.expires_at);
  if (!Number.isFinite(expires) || expires <= Date.now()) throw failure();
}
function validateArchiveEntry(entry, paths) {
  const name = entry.fileName; const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
  if (entry.isEncrypted() || paths.has(name) || (mode && ![0o100000, 0o040000].includes(mode))) throw failure();
  paths.add(name);
  if (name.endsWith('/')) {
    if (mode && mode !== 0o040000) throw failure();
    if (name !== 'content/') {
      if (!name.startsWith('content/')) throw failure();
      requireRelativeTemplatePath(name.slice(8, -1));
    }
    return true;
  }
  if (mode === 0o040000) throw failure();
  if (name !== 'manifest.json') {
    if (!name.startsWith('content/')) throw failure();
    requireSafeContentPath(name.slice(8));
  }
  return false;
}
