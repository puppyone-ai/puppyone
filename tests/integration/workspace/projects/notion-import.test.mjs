import { describe, it, expect } from 'vitest';
import { createLocalProjectImportService } from '../../../../electron/main/project-import/service.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';
const DB = '33333333-3333-4333-8333-333333333333';
const ROW = '44444444-4444-4444-8444-444444444444';
const PAGE = (id, name) => ({ object: 'page', id, url: 'https://www.notion.so/' + id, properties: { title: { type: 'title', title: [{ plain_text: name }] } } });
const list = (results, next = null) => ({ results, has_more: !!next, next_cursor: next });

async function fixture(options = {}) {
  const module = await import('../../../../electron/main/project-import/sources/notion.mjs').catch(() => ({}));
  expect(module.createImportSource, 'Notion must provide a real remote import adapter').toBeTypeOf('function');
  const calls = [];
  const routes = new Map([
    ['POST /search', list([PAGE(ROOT, '研究项目')], 'next')],
    ['POST /search?next', list([{ object: 'data_source', id: DB, title: [{ plain_text: '访谈' }] }])],
    ['GET /pages/' + ROOT, PAGE(ROOT, '研究项目')],
    ['GET /pages/' + CHILD, PAGE(CHILD, '计划')],
    ['GET /pages/' + ROW, PAGE(ROW, '访谈甲')],
    ['GET /pages/' + ROOT + '/markdown?markdown_version=v2', { markdown: '# 原文\n[计划](https://www.notion.so/' + CHILD + ')\n![图片](https://prod-files-secure.s3.us-west-2.amazonaws.com/picture.png?signature=x)', truncated: false, unknown_block_ids: [] }],
    ['GET /pages/' + CHILD + '/markdown?markdown_version=v2', { markdown: '# 计划', truncated: true, unknown_block_ids: ['unavailable'] }],
    ['GET /pages/' + ROW + '/markdown?markdown_version=v2', { markdown: '访谈内容', truncated: false, unknown_block_ids: [] }],
    ['GET /blocks/' + ROOT + '/children?page_size=100', list([
      { id: CHILD, type: 'child_page', child_page: { title: '计划' } },
      { id: DB, type: 'child_database', child_database: { title: '访谈' } },
      { id: 'image', type: 'image', image: { type: 'file', file: { url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/picture.png?signature=' + (options.differentSignature ? 'other' : 'x') } } },
      { id: 'link', type: 'link_to_page', link_to_page: { type: 'page_id', page_id: 'unselected-page' } },
    ])],
    ['GET /blocks/' + CHILD + '/children?page_size=100', list([])],
    ['GET /blocks/' + ROW + '/children?page_size=100', list([])],
    ['GET /databases/' + DB, { object: 'database', id: DB, title: [{ plain_text: '访谈' }], data_sources: [{ id: DB }] }],
    ['GET /data_sources/' + DB, { object: 'data_source', id: DB, title: [{ plain_text: '访谈' }], properties: { title: { type: 'title' } } }],
    ['POST /data_sources/' + DB + '/query', list([PAGE(ROW, '访谈甲')])],
  ]);
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ url: String(url), init });
    if (parsed.hostname === 'prod-files-secure.s3.us-west-2.amazonaws.com') {
      expect(new Headers(init.headers).has('Authorization')).toBe(false);
      return options.badAttachment ? new Response('missing', { status: 404 }) : new Response(new Uint8Array([137, 80, 78, 71]));
    }
    expect(parsed.origin).toBe('https://api.notion.com');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-access');
    let key = (init.method || 'GET') + ' ' + parsed.pathname.replace('/v1', '') + parsed.search;
    if (parsed.pathname === '/v1/search' && JSON.parse(init.body).start_cursor) key += '?next';
    const value = routes.get(key);
    if (!value) throw new Error('Unexpected Notion API request: ' + key);
    return Response.json(value);
  };
  const adapter = module.createImportSource({ fetchImpl, connectNotion: async () => ({ accessToken: 'test-access' }) });
  return { adapter, calls, routes };
}

describe('Notion API import', () => {
  it('paginates authorized resources without passing credentials to the renderer', async () => {
    const { adapter } = await fixture();
    const connection = await adapter.connect({});
    const page = await adapter.listResources({ connection, parentId: null, cursor: null });
    expect(page.items).toEqual([{ id: ROOT, name: '研究项目', kind: 'document' }]);
    expect(page.nextCursor).toBe('next');
    const next = await adapter.listResources({ connection, parentId: null, cursor: page.nextCursor });
    expect(next.items[0].kind).toBe('database');
    expect(JSON.stringify(page)).not.toContain('test-access');
  });

  it('imports only the selected subtree, localizes assets and links, and records missing coverage', async () => {
    const { adapter, calls } = await fixture();
    const connection = await adapter.connect({});
    const prepared = await adapter.inspect({ resourceId: ROOT, includeSubpages: true }, { connection });
    const files = new Map();
    await adapter.materialize({ source: prepared.source, connection, writer: { writeFile: async (name, data) => files.set(name, Buffer.from(data)) }, onProgress() {} });
    const report = files.get('migration/report.md').toString();
    const manifest = JSON.parse(files.get('migration/manifest.json'));
    expect(manifest.source.kind).toBe('notion-api');
    expect(manifest.status).toBe('needs_review');
    expect(manifest.pages).toHaveLength(3);
    expect(manifest.issues.some(i => i.code === 'incomplete_page')).toBe(true);
    expect(report).toContain('unavailable');
    const root = manifest.pages.find(p => p.id === ROOT);
    expect(files.get(root.path).toString()).not.toContain('signature=x');
    expect(files.get(root.path).toString()).toContain('计划');
    expect([...files.keys()].some(name => name.endsWith('.csv'))).toBe(true);
    expect([...files].some(([name, bytes]) => name.startsWith('content/assets/') && bytes.equals(Buffer.from([137, 80, 78, 71])))).toBe(true);
    expect([...files.keys()].some(name => name.startsWith('migration/source/'))).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain('test-access');
    expect(calls.some(call => call.url.includes('unselected-page'))).toBe(false);
  });

  it('honors a single-page scope and reports failed attachments', async () => {
    const { adapter, calls } = await fixture({ badAttachment: true });
    const connection = await adapter.connect({});
    const prepared = await adapter.inspect({ resourceId: ROOT, includeSubpages: false }, { connection });
    const files = new Map();
    await adapter.materialize({ source: prepared.source, connection, writer: { writeFile: async (name, data) => files.set(name, Buffer.from(data)) }, onProgress() {} });
    const manifest = JSON.parse(files.get('migration/manifest.json'));
    expect(manifest.pages).toHaveLength(1);
    expect(manifest.issues.some(i => i.code === 'attachment_failed')).toBe(true);
    expect(calls.some(call => call.url.includes('/pages/' + CHILD))).toBe(false);
  });

  it('publishes through the existing coordinator and rejects unselected resources', async () => {
    const { adapter } = await fixture();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'notion-import-test-'));
    try {
      const service = createLocalProjectImportService({ adapters: { notion: adapter }, descriptors: [{ id: 'notion', mode: 'remote', operational: true }], validateName: name => name, publish: (from, to) => fs.rename(from, to) });
      const { connectionId } = await service.connectSource({ provider: 'notion', ownerId: 1 });
      expect(Object.keys({ connectionId })).toEqual(['connectionId']);
      await expect(service.importProject({ parentPath: directory, source: { provider: 'notion', connectionId, resourceId: CHILD }, ownerId: 1 })).rejects.toThrow('Choose a resource');
      await service.listResources({ provider: 'notion', connectionId, ownerId: 1 });
      const result = await service.importProject({ parentPath: directory, source: { provider: 'notion', connectionId, resourceId: ROOT }, ownerId: 1 });
      expect(await fs.readFile(path.join(result.path, 'migration/report.md'), 'utf8')).toContain('Notion');
      await expect(service.importProject({ parentPath: directory, source: { provider: 'notion', connectionId, resourceId: ROOT }, ownerId: 2 })).rejects.toThrow('Reconnect');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });


  it('localizes an asset even when Markdown and block APIs sign its URL differently', async () => {
    const { adapter } = await fixture({ differentSignature: true });
    const connection = await adapter.connect({});
    const prepared = await adapter.inspect({ resourceId: ROOT, includeSubpages: false }, { connection });
    const files = new Map();
    await adapter.materialize({ source: prepared.source, connection, writer: { writeFile: async (name, data) => files.set(name, Buffer.from(data)) } });
    const manifest = JSON.parse(files.get('migration/manifest.json'));
    const markdown = files.get(manifest.pages[0].path).toString();
    expect(markdown).toContain('./assets/');
    expect(markdown).not.toContain('amazonaws.com');
  });

  it('fails instead of publishing a project after a local attachment write error', async () => {
    const { adapter } = await fixture();
    const connection = await adapter.connect({});
    const prepared = await adapter.inspect({ resourceId: ROOT, includeSubpages: false }, { connection });
    await expect(adapter.materialize({ source: prepared.source, connection, writer: { writeFile: async name => {
      if (name.startsWith('content/assets/')) throw new Error('Disk full');
    } } })).rejects.toThrow('Disk full');
  });

  it('preserves empty database column names and identifies downloaded attachments', async () => {
    const { adapter, routes } = await fixture();
    routes.set('POST /data_sources/' + DB + '/query', list([]));
    const connection = await adapter.connect({});
    const prepared = await adapter.inspect({ resourceId: ROOT }, { connection });
    const files = new Map();
    await adapter.materialize({ source: prepared.source, connection, writer: { writeFile: async (name, data) => files.set(name, Buffer.from(data)) } });
    const manifest = JSON.parse(files.get('migration/manifest.json'));
    expect(files.get(manifest.tables[0].path).toString()).toContain('"title"');
    expect(manifest.assets[0]).toMatchObject({ name: 'picture.png', path: expect.stringContaining('content/assets/'), source_url: expect.stringContaining('amazonaws.com/picture.png') });
  });

  it('passes cancellation into the initial metadata request', async () => {
    const module = await import('../../../../electron/main/project-import/sources/notion.mjs');
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const controller = new AbortController();
    const adapter = module.createImportSource({ fetchImpl: async (_url, { signal }) => {
      started();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Metadata request cancelled')), { once: true }));
    } });
    const pending = adapter.inspect({ resourceId: ROOT }, { connection: { accessToken: 'test-access' }, signal: controller.signal });
    await ready; controller.abort();
    await expect(pending).rejects.toThrow(/cancel/i);
  });

  it('stops on cancellation before writing', async () => {
    const { adapter } = await fixture();
    const controller = new AbortController(); controller.abort();
    const files = [];
    await expect(adapter.materialize({ source: { resourceId: ROOT }, connection: { accessToken: 'test-access' }, signal: controller.signal, writer: { writeFile: async name => files.push(name) }, onProgress() {} })).rejects.toThrow(/cancel|abort/i);
    expect(files).toEqual([]);
  });
});
