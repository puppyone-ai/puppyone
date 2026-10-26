import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createCloudNativePreviewService } from '../../../../electron/main/cloud-native-preview-service.mjs';
import { createCloudPreviewResourceService } from '../../../../electron/main/cloud-preview-resource-service.mjs';
import { isAllowedPdfResource } from '../../../../electron/main/embedded-pdf-security.mjs';

function fixture(name = 'database.sqlite') {
  const input = { id: 'preview', apiBaseUrl: 'https://cloud-fixture.puppyone.ai/api/v1', projectId: 'project', path: name,
    workbench: { id: 'workbench', generation: 'one' }, expectedSession: { userId: 'actor', generation: 'session' } };
  let bytes = Buffer.from(name.endsWith('.pdf') ? '%PDF-1.7\nlive' : 'uncommitted database'), sidecars = [];
  const auth = { readSession: async () => ({ user_id: 'actor', session_generation: 'session', api_base_url: input.apiBaseUrl }),
    requestSessionApi: vi.fn(async (_base, endpoint) => {
      if (endpoint.includes('/files?')) return { entries: sidecars.map(name => ({ name })) };
      if (!endpoint.includes('/workbench/file?')) throw new Error('Must read the live workspace');
      return { name, size: bytes.length, content_base64: bytes.toString('base64'), revision: createHash('sha256').update(bytes).digest('hex') };
    }) };
  return { input, auth, change: content => { bytes = Buffer.from(content); }, sidecars: names => { sidecars = names; } };
}
describe('live native previews', () => {
  it('decodes uncommitted workspace bytes and cleans up the private snapshot', async () => {
    const f = fixture(), directory = await mkdtemp(path.join(os.tmpdir(), 'live-preview-test-'));
    const database = { open: vi.fn(async (_owner, request) => {
      expect(await readFile(path.join(request.rootPath, request.path), 'utf8')).toBe('uncommitted database'); return { engine: 'sqlite' };
    }), close: vi.fn(), page: vi.fn() };
    const fetchResource = vi.fn();
    const service = createCloudNativePreviewService({ auth: f.auth, database, convertOffice: vi.fn(), fetchResource, temporaryRoot: directory });
    try {
      expect(await service.openDatabase(1, f.input)).toEqual({ engine: 'sqlite' });
      expect(fetchResource).not.toHaveBeenCalled();
      await service.closeAll(); expect(await readdir(directory)).toEqual([]);
      f.sidecars(['database.sqlite-wal']);
      await expect(service.openDatabase(1, f.input)).rejects.toMatchObject({ code: 'recovery-required' });
      expect(database.open).toHaveBeenCalledOnce();
    } finally { await service.closeAll(); await rm(directory, { recursive: true, force: true }); }
  });
  it('rejects a database changed during snapshot acquisition', async () => {
    const f = fixture(), original = f.auth.requestSessionApi.getMockImplementation();
    let reads = 0;
    f.auth.requestSessionApi.mockImplementation(async (...args) => {
      if (args[1].includes('/file?') && ++reads === 2) f.change('changed');
      return original(...args);
    });
    const directory = await mkdtemp(path.join(os.tmpdir(), 'live-preview-test-'));
    const database = { open: vi.fn(), close: vi.fn() };
    const service = createCloudNativePreviewService({ auth: f.auth, database, convertOffice: vi.fn(), temporaryRoot: directory });
    try { await expect(service.openDatabase(1, f.input)).rejects.toMatchObject({ code: 'stale-input' }); expect(database.open).not.toHaveBeenCalled(); }
    finally { await service.closeAll(); await rm(directory, { recursive: true, force: true }); }
  });
  it('admits only retained live PDF blob capabilities, then revokes them', async () => {
    const f = fixture('report.pdf'), service = createCloudPreviewResourceService({ auth: f.auth });
    const blobUrl = 'blob:null/8d63d178-e392-4ea2-b999-61c8c3f4f93e';
    expect(isAllowedPdfResource(blobUrl, service.allowed)).toBe(false);
    expect(await service.retain(1, { ...f.input, blobUrl })).toEqual({ url: blobUrl });
    expect(isAllowedPdfResource(blobUrl, service.allowed)).toBe(true);
    expect(isAllowedPdfResource('blob:null/other', service.allowed)).toBe(false);
    service.revoke(1, blobUrl); expect(isAllowedPdfResource(blobUrl, service.allowed)).toBe(false);
    f.change('not a PDF'); await expect(service.retain(1, { ...f.input, blobUrl })).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
