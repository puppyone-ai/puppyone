/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudDataService } from '../../../../src/features/cloud/files/cloudDataPort';
import { createCloudWorkspaceClient } from '../../../../src/features/cloud/files/cloudWorkspaceClient';
import type { DesktopCloudSession } from '../../../../src/lib/cloudApi';
import { liveWorkbench, liveFile, liveEntry, fileRevision, fileVersion } from '../../../fixtures/cloud/repositories/liveWorkspace';

const apiBaseUrl = 'https://cloud-fixture.puppyone.ai/api/v1';
const session: DesktopCloudSession = { api_base_url: apiBaseUrl, user_id: 'owner', user_email: 'owner@example.com',
  session_generation: 'one', expires_at: Date.now() + 3600000, expires_in: 3600, status: 'authenticated' };
const context = { status: 'resolved' as const, projectId: 'project', projectName: 'Project',
  target: { kind: 'project_root' as const, project_id: 'project' }, capabilities: ['content.read', 'content.write'] };
const failure = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
let files: Map<string, string>;
let row: ReturnType<typeof liveWorkbench> | null;
let request: ReturnType<typeof vi.fn<(input: any) => Promise<any>>>;
let listener: (event: {id: string; type: 'change' | 'unavailable'; generation?: string}) => void;
let subscription: { id: string; generation: string };
let stop: ReturnType<typeof vi.fn>;
const service = (extra: Partial<Parameters<typeof createCloudDataService>[0]> = {}) => createCloudDataService({ session, context, apiBaseUrl, ...extra });
const save = (cloud: ReturnType<typeof service>, content: string, baseVersion: string | null) =>
  cloud.dataPort.documentPersistence!.persist({ path: 'readme.md', content, baseVersion, reason: 'edit', revision: '1' });
beforeEach(() => {
  vi.restoreAllMocks(); files = new Map([['readme.md', 'initial'], ['picture.png', 'png'], ['page.html', '<p>initial</p>']]); row = liveWorkbench();
  request = vi.fn(async (input) => {
    const url = new URL(input.path, apiBaseUrl), path = url.searchParams.get('path') ?? '';
    const body = input.body ? JSON.parse(input.body) : null;
    if (url.pathname.endsWith('/workbench')) {
      if (input.method === 'POST') { row = { ...(row ?? liveWorkbench()), state: 'running' }; return row; }
      return { workspace: row };
    }
    if (row?.state !== 'running' || url.searchParams.get('generation') !== row.generation) throw failure(409);
    if (url.pathname.endsWith('/files')) {
      if (input.method === 'GET') return { entries: [...files].filter(([name]) => !name.includes('/')).map(([name, content]) => liveEntry(name, content)) };
      if (body.action === 'remove') files.delete(body.path);
      if (body.action === 'move') { if (files.has(body.destination)) throw failure(409); files.set(body.destination, files.get(body.path)!); files.delete(body.path); }
      return {};
    }
    if (url.pathname.endsWith('/file')) {
      if (input.method === 'PUT') {
        if ((files.has(body.path) ? fileRevision(files.get(body.path)!) : null) !== body.expected_revision) throw failure(409);
        const content = Buffer.from(body.content_base64, 'base64').toString(); files.set(body.path, content); return { revision: fileRevision(content) };
      }
      if (!files.has(path)) throw failure(404);
      return liveFile(path, files.get(path)!);
    }
    throw new Error(`Unexpected endpoint: ${input.path}`);
  });
  stop = vi.fn(async () => {});
  window.puppyoneDesktop = { requestCloudSessionApi: request,
    watchCloudWorkspace: vi.fn(async input => { subscription = input; return { id: input.id }; }),
    stopCloudWorkspaceWatch: stop,
    onCloudWorkspaceEvent: vi.fn(callback => { listener = callback; return () => {}; }),
  } as unknown as NonNullable<typeof window.puppyoneDesktop>;
});

describe('live Cloud files', () => {
  it('reads Agent writes before any Git commit, and writes bytes the Agent can read', async () => {
    const cloud = service();
    expect((await cloud.dataPort.readFile!('readme.md')).content).toBe('initial');
    files.set('readme.md', 'Agent is still working');
    const current = await cloud.dataPort.readFile!('readme.md');
    expect(current.content).toBe('Agent is still working');
    expect(await save(cloud, 'human edit', current.version!)).toEqual({ ok: true, version: fileVersion('human edit') });
    expect(files.get('readme.md')).toBe('human edit');
    expect(request.mock.calls.every(([input]) => input.path.includes('/workbench'))).toBe(true);
    expect(JSON.stringify(request.mock.calls)).not.toMatch(/base_commit|\/content\/|\/git\//);
  });
  it('opens an absent workspace once for concurrent consumers', async () => {
    row = null;
    await Promise.all([service().dataPort.readFile!('readme.md'), service().dataPort.listChildren(null)]);
    expect(request.mock.calls.filter(([input]) => input.method === 'POST' && input.path.endsWith('/workbench'))).toHaveLength(1);
  });
  it('coalesces concurrent directory reads without retaining a stale listing after invalidation', async () => {
    const cloud = service();
    await Promise.all([cloud.dataPort.listChildren(null), cloud.dataPort.listChildren(null)]);
    expect(request.mock.calls.filter(([input]) => input.path.includes('/files?'))).toHaveLength(1);
    cloud.invalidateReads(); files.set('new.md', 'Agent created');
    expect((await cloud.dataPort.listChildren(null)).some(entry => entry.name === 'new.md')).toBe(true);
    expect(request.mock.calls.filter(([input]) => input.path.includes('/files?'))).toHaveLength(2);
  });
  it('protects an old editor draft after an Agent save', async () => {
    const cloud = service(), baseline = await cloud.dataPort.readFile!('readme.md');
    files.set('readme.md', 'Agent edit');
    expect(await save(cloud, 'old draft', baseline.version!)).toMatchObject({ ok: false, kind: 'conflict', content: 'Agent edit' });
    expect(files.get('readme.md')).toBe('Agent edit');
  });
  it('does not send restored Git baselines or another workspace generation to the writer', async () => {
    const cloud = service();
    await save(cloud, 'draft', 'cloud-git:{}');
    await save(cloud, 'draft', fileVersion('initial', 'other'));
    expect(request.mock.calls.some(([input]) => input.method === 'PUT')).toBe(false);
  });
  it('creates with no-clobber and keeps native names during move and delete', async () => {
    const cloud = service();
    await expect(cloud.dataPort.createFile!('readme.md', 'replace')).rejects.toThrow(/already exists/);
    await cloud.dataPort.createFile!('config.ini', 'native');
    await cloud.dataPort.renameNode!('config.ini', 'config.cfg');
    expect(files.get('config.cfg')).toBe('native');
    await cloud.dataPort.deleteNode!('config.cfg'); expect(files.has('config.cfg')).toBe(false);
    expect(JSON.parse(request.mock.calls.find(([input]) => input.method === 'PUT')![0].body).expected_revision).toBeNull();
  });
  it('does not clobber a file created after directory listing', async () => {
    const cloud = service(), original = request.getMockImplementation()!;
    request.mockImplementation(async input => { const result = await original(input); if (input.path.includes('/files?')) files.set('new.md', 'other writer'); return result; });
    await expect(cloud.dataPort.createFile!('new.md', 'mine')).rejects.toMatchObject({ status: 409 });
    expect(files.get('new.md')).toBe('other writer');
  });
  it('rejects path escapes, scope roots and read-only writes', async () => {
    const cloud = service();
    await expect(cloud.dataPort.readFile!('../secret')).rejects.toThrow(/traversal/);
    await expect(cloud.dataPort.deleteNode!(cloud.folder.uri)).rejects.toThrow(/root/);
    expect(() => service({ context: { ...context, target: { kind: 'scope', project_id: 'project', scope_id: 'scope' }, scopePath: 'notes' } })).toThrow(/complete project/);
    expect(service({ context: { ...context, capabilities: ['content.read'] } }).dataPort.documentPersistence).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps a persistent watch; file notifications invalidate cached directories', async () => {
    const cloud = service(), changed = vi.fn(), failed = vi.fn();
    await cloud.dataPort.listChildren(null);
    const close = cloud.watch!(changed, failed);
    await vi.waitFor(() => expect(subscription).toBeTruthy());
    listener({ ...subscription, type: 'change' });
    expect(cloud.dataPort.getCachedChildren!(null)).toBeUndefined(); expect(changed).toHaveBeenCalledOnce();
    listener({ id: 'other', generation: row!.generation, type: 'change' }); expect(changed).toHaveBeenCalledOnce();
    close(); listener({ ...subscription, type: 'change' }); expect(changed).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith({ id: subscription.id });
  });
  it('reports paused workspaces and only resumes on explicit retry', async () => {
    const cloud = service(); await cloud.dataPort.readFile!('readme.md'); request.mockClear(); row!.state = 'paused';
    await expect(cloud.dataPort.readFile!('readme.md')).rejects.toMatchObject({ status: 409 });
    expect(request.mock.calls.some(([input]) => input.method === 'POST')).toBe(false);
    await cloud.resume!(); expect((await cloud.dataPort.readFile!('readme.md')).content).toBe('initial');
  });
  it('refuses a replacement generation instead of redirecting a retained draft', async () => {
    const cloud = service(); await cloud.dataPort.readFile!('readme.md'); row!.generation = 'replacement';
    await expect(cloud.resume!()).rejects.toThrow(/replaced/);
  });
  it('rejects late responses and queued saves after account or project switches', async () => {
    let current = true; const cloud = service({ isCurrent: () => { return current; } });
    const original = request.getMockImplementation()!;
    request.mockImplementation(async input => { const result = await original(input); current = false; return result; });
    await expect(cloud.dataPort.readFile!('readme.md')).rejects.toThrow(/session changed/);
    expect(files.get('readme.md')).toBe('initial');
  });
  it('does not allocate a workspace after a pending open loses its account or project', async () => {
    row = null;
    let current = true;
    const cloud = service({ isCurrent: () => current });
    const original = request.getMockImplementation()!;
    request.mockImplementation(async input => {
      const result = await original(input);
      if (input.path.endsWith('/workbench') && input.method === 'GET') current = false;
      return result;
    });
    await expect(cloud.dataPort.listChildren(null)).rejects.toThrow(/session changed/);
    expect(request.mock.calls.some(([input]) => input.method === 'POST')).toBe(false);
  });
  it('previews accepted HTML snapshots and live binary bytes without signing Git URLs', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const cloud = service(), file = await cloud.dataPort.readFile!('page.html');
    files.set('page.html', '<p>later</p>');
    await cloud.dataPort.getFileUrl!('page.html', { expectedVersion: file.version! });
    expect(await (create.mock.calls[0][0] as Blob).text()).toBe('<p>initial</p>');
    files.set('picture.png', 'new image'); await cloud.dataPort.getFileUrl!('picture.png');
    expect(await (create.mock.calls[1][0] as Blob).text()).toBe('new image');
    expect((create.mock.calls[1][0] as Blob).type).toBe('image/png');
    await cloud.dataPort.revokeFileUrl!('blob:fixture'); expect(revoke).toHaveBeenCalledOnce();
  });
  it('embeds live asset bytes in opaque HTML projections without exposing parent Blob URLs', async () => {
    const createDocument = vi.fn(async () => ({ url: 'puppyone-preview://fixture/index.html' }));
    Object.assign(window.puppyoneDesktop!, { createSandboxedPreviewDocument: createDocument,
      revokeSandboxedPreviewDocument: vi.fn(async () => ({ revoked: true })) });
    files.set('picture.png', 'Agent image');
    const cloud = service();
    const projection = await cloud.dataPort.previewServices!.documentProjection!.create('page.html',
      '<img src="picture.png">', new AbortController().signal);
    expect((createDocument.mock.calls[0] as any)[0].content).toContain('data:image/png;base64,' + btoa('Agent image'));
    await projection.close();
  });
  it('bounds preview and editor bytes without using a published fallback', async () => {
    const cloud = service(); files.set('huge.txt', 'a'.repeat(8 * 1024 * 1024 + 1));
    await expect(cloud.dataPort.getFileUrl!('huge.txt')).rejects.toThrow(/8 MiB/);
    expect(await save(cloud, 'a'.repeat(8 * 1024 * 1024 + 1), fileVersion('initial'))).toMatchObject({ ok: false });
    expect(files.get('readme.md')).toBe('initial');
  });
  it('exposes the same workbench identity to independently constructed clients', async () => {
    const left = createCloudWorkspaceClient(session, context, apiBaseUrl);
    const right = createCloudWorkspaceClient(session, context, apiBaseUrl);
    expect(await left.ensure()).toEqual(await right.ensure());
  });
});
