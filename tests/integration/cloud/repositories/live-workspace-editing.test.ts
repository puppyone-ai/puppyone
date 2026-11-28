/** @vitest-environment happy-dom */
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloudDataService } from '../../../../src/features/cloud/files/cloudDataPort';
import { DocumentEditingSession } from '../../../../src/shared-ui/editor/document-session/DocumentEditingSession';
import { AUTO_SAVE_IDLE_MS } from '../../../../src/shared-ui/editor/document-session/autoSavePolicy';
import { registerCloudIpcHandlers } from '../../../../electron/main/ipc/cloud-ipc.mjs';
import { requestCloudApi } from '../../../../electron/main/cloud-api-client.mjs';
import type { DesktopCloudSession } from '../../../../src/lib/cloudApi';
import { liveWorkbench, liveFile, liveEntry, fileRevision } from '../../../fixtures/cloud/repositories/liveWorkspace';

const run = promisify(execFile);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A live workspace over a real directory, served through real HTTP, the real
 * Main IPC handlers and an SSE stream. Like the sandbox watcher, every file
 * change is announced with its workspace-relative path.
 */
async function startWorkspace(initial: Record<string, string>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-live-editing-'));
  for (const [name, content] of Object.entries(initial)) await writeFile(path.join(directory, name), content);
  const streams = new Set<ServerResponse>();
  const workspace = liveWorkbench();
  const requests: string[] = [];
  const held = new Map<string, Promise<void>>();
  const announce = (paths?: string[]) => {
    for (const stream of streams) stream.write(`event: change\ndata: ${JSON.stringify({ generation: workspace.generation, reset: true, ...(paths ? { paths } : {}) })}\n\n`);
  };
  const server = createServer(async (request, response) => {
    try {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', '*');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
      const url = new URL(request.url!, 'http://localhost'), resource = url.searchParams.get('path') ?? '';
      requests.push(`${request.method} ${url.pathname.replace(/^.*\/workbench/, '') || '/'}${resource ? `?${resource}` : ''}`);
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname.endsWith('/workbench')) { response.end(JSON.stringify(request.method === 'POST' ? workspace : { workspace })); return; }
      if (url.searchParams.get('generation') !== workspace.generation) { response.writeHead(409).end('{}'); return; }
      if (url.pathname.endsWith('/events')) {
        response.setHeader('Content-Type', 'text/event-stream'); response.flushHeaders(); streams.add(response); announce();
        response.on('close', () => streams.delete(response)); return;
      }
      if (url.pathname.endsWith('/files')) {
        const names = await readdir(directory);
        response.end(JSON.stringify({ entries: await Promise.all(names.map(async (name) => liveEntry(name, await readFile(path.join(directory, name), 'utf8')))) }));
        return;
      }
      const filename = path.join(directory, resource);
      if (request.method === 'PUT') {
        let data = ''; for await (const chunk of request) data += chunk;
        await held.get(resource);
        const body = JSON.parse(data);
        const before = await readFile(filename).catch(() => null);
        if ((before ? fileRevision(before) : null) !== body.expected_revision) { response.writeHead(409).end('{}'); return; }
        const bytes = Buffer.from(body.content_base64, 'base64'); await writeFile(filename, bytes);
        response.end(JSON.stringify({ revision: fileRevision(bytes) }));
        announce([resource]);
        return;
      }
      const bytes = await readFile(filename).catch(() => null);
      if (!bytes) { response.writeHead(404).end('{}'); return; }
      response.end(JSON.stringify(liveFile(resource, bytes)));
    } catch (error) { response.writeHead(500).end(JSON.stringify({ message: String(error) })); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const apiBaseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
  const session: DesktopCloudSession = { user_id: 'actor', user_email: 'fixture@example.com', api_base_url: apiBaseUrl,
    session_generation: 'session', status: 'authenticated', expires_at: Date.now() + 3600000, expires_in: 3600 };
  const handlers = new Map<string, (...args: any[]) => any>();
  const events = new EventEmitter();
  const owner = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false,
    send: (channel: string, value: unknown) => events.emit(channel, value) });
  registerCloudIpcHandlers({ ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
    cloudAuthService: { readSession: async () => session, requestSessionApi: requestCloudApi } });
  const original = window.puppyoneDesktop;
  window.puppyoneDesktop = {
    requestCloudSessionApi: (input: unknown) => handlers.get('cloud:session-api-request')!({ sender: owner }, input),
    watchCloudWorkspace: (input: unknown) => handlers.get('cloud-workspace:watch')!({ sender: owner }, input),
    stopCloudWorkspaceWatch: async (input: unknown) => handlers.get('cloud-workspace:stop')!({ sender: owner }, input),
    onCloudWorkspaceEvent: (listener: (event: unknown) => void) => { events.on('cloud-workspace:event', listener); return () => { events.off('cloud-workspace:event', listener); }; },
  } as unknown as NonNullable<typeof window.puppyoneDesktop>;
  const service = () => createCloudDataService({ apiBaseUrl, session, context: { status: 'resolved', projectId: 'project', projectName: 'Fixture',
    target: { kind: 'project_root', project_id: 'project' }, capabilities: ['content.read', 'content.write'] } });
  return {
    directory, requests, service, announce,
    disk: (name: string) => readFile(path.join(directory, name), 'utf8'),
    /** An Agent's shell write in the workspace, announced as the sandbox watcher would. */
    async agentWrites(name: string, content: string) {
      await run('/bin/bash', ['-c', `printf "%s" "${content}" > ${name}`], { cwd: directory });
      announce([name]);
    },
    hold(resource: string) {
      let release!: () => void;
      held.set(resource, new Promise<void>((resolve) => { release = resolve; }));
      return () => { release(); held.delete(resource); };
    },
    countSince: (mark: number, prefix: string) => requests.slice(mark).filter((entry) => entry.startsWith(prefix)).length,
    async close() {
      owner.emit('destroyed'); window.puppyoneDesktop = original;
      for (const stream of streams) stream.destroy(); server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** An editor for one Cloud document: the production session over a simple text model. */
async function openEditor(cloud: ReturnType<Awaited<ReturnType<typeof startWorkspace>>['service']>, name: string) {
  const file = await cloud.dataPort.readFile!(name);
  const session = new DocumentEditingSession({ documentId: name, initialContent: file.content!, initialVersion: file.version,
    saveMode: 'auto', persistence: cloud.dataPort.documentPersistence! });
  let text = file.content!;
  let revision = 0;
  session.attachSource({
    readSnapshot: () => ({ content: text, revision: String(revision) }),
    replaceContent: (content) => { text = content; revision += 1; return { content: text, revision: String(revision) }; },
  });
  return {
    session,
    text: () => text,
    type(next: string) { text = next; revision += 1; session.reportRevision({ revision: String(revision), origin: 'local-edit' }); },
    /** What the document input does after a change names this file. */
    async revalidate() {
      const latest = await cloud.dataPort.readFile!(name);
      return session.reconcileExternalBaseline(latest.content!, latest.version);
    },
  };
}

let live: Awaited<ReturnType<typeof startWorkspace>>;
beforeEach(async () => { live = await startWorkspace({ 'notes.md': 'start', 'other.md': 'other' }); });
afterEach(async () => { await live.close(); });

describe('Cloud editing over a live workspace', () => {
  it('writes a typing burst once after the pause, and the bytes land in the workspace', async () => {
    const cloud = live.service();
    const editor = await openEditor(cloud, 'notes.md');
    const mark = live.requests.length;
    for (const word of ['s', 'st', 'sta', 'star', 'start ', 'start t', 'start ty', 'start typ', 'start typing']) {
      editor.type(word); await pause(60);
    }
    expect(live.countSince(mark, 'PUT')).toBe(0);
    await vi.waitFor(() => expect(live.countSince(mark, 'PUT')).toBe(1), { timeout: AUTO_SAVE_IDLE_MS * 3 });
    await vi.waitFor(() => expect(editor.session.hasUnpersistedChanges()).toBe(false));
    expect(await live.disk('notes.md')).toBe('start typing');
    expect(live.countSince(mark, 'GET /files')).toBe(0);
    editor.session.dispose();
  }, 15000);

  it('names the saved file in its echo; re-reading it acknowledges the save without another write', async () => {
    const cloud = live.service();
    const changed = vi.fn(), failed = vi.fn();
    const stop = cloud.watch!(changed, failed);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(null));
    const editor = await openEditor(cloud, 'notes.md');
    changed.mockClear();
    editor.type('saved by the person');
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(['notes.md']), { timeout: AUTO_SAVE_IDLE_MS * 4 });
    const mark = live.requests.length;
    expect(await editor.revalidate()).toBe('acknowledged');
    await pause(AUTO_SAVE_IDLE_MS + 100);
    expect(live.requests.slice(mark)).toEqual(['GET /file?notes.md']);
    expect(editor.session.getState()).toMatchObject({ error: null });
    expect(failed).not.toHaveBeenCalled();
    stop(); editor.session.dispose();
  }, 15000);

  it('keeps unsaved typing when an Agent writes the same file, and never writes over the Agent', async () => {
    const cloud = live.service();
    const editor = await openEditor(cloud, 'notes.md');
    editor.type('my unsaved paragraph');
    await live.agentWrites('notes.md', 'Agent rewrote notes');
    expect(await editor.revalidate()).toBe('deferred');
    expect(editor.text()).toBe('my unsaved paragraph');
    expect(editor.session.getState()).toMatchObject({ status: 'error', error: { code: 'external-conflict' } });

    const mark = live.requests.length;
    editor.type('my unsaved paragraph, continued');
    await pause(AUTO_SAVE_IDLE_MS * 2);
    expect(live.countSince(mark, 'PUT')).toBe(0);
    expect(await live.disk('notes.md')).toBe('Agent rewrote notes');

    editor.session.reloadExternalBaseline();
    expect(editor.text()).toBe('Agent rewrote notes');
    expect(editor.session.getState()).toMatchObject({ status: 'clean', error: null });
    editor.session.dispose();
  }, 15000);

  it('adopts an Agent write into a clean document without writing it back', async () => {
    const cloud = live.service();
    const editor = await openEditor(cloud, 'notes.md');
    const mark = live.requests.length;
    await live.agentWrites('notes.md', 'Agent appended a section');
    expect(await editor.revalidate()).toBe('applied');
    expect(editor.text()).toBe('Agent appended a section');
    await pause(AUTO_SAVE_IDLE_MS + 100);
    expect(live.countSince(mark, 'PUT')).toBe(0);
    editor.session.dispose();
  }, 15000);

  it('lets a second window keep its draft instead of overwriting the first window\'s save', async () => {
    const first = await openEditor(live.service(), 'notes.md');
    const second = await openEditor(live.service(), 'notes.md');
    first.type('first window text');
    await vi.waitFor(async () => expect(await live.disk('notes.md')).toBe('first window text'), { timeout: AUTO_SAVE_IDLE_MS * 3 });

    second.type('second window text');
    await vi.waitFor(() => expect(second.session.getState().error?.code).toBe('external-conflict'), { timeout: AUTO_SAVE_IDLE_MS * 3 });
    expect(await live.disk('notes.md')).toBe('first window text');
    expect(second.text()).toBe('second window text');
    expect(second.session.hasUnpersistedChanges()).toBe(true);
    first.session.dispose(); second.session.dispose();
  }, 15000);

  it('creates another file while a slow save is still in flight', async () => {
    const cloud = live.service();
    const editor = await openEditor(cloud, 'notes.md');
    const release = live.hold('notes.md');
    editor.type('slow network save');
    editor.session.flushPendingAutoSave();
    await vi.waitFor(() => expect(live.requests).toContain('PUT /file?notes.md'));

    await cloud.dataPort.createFile!('fresh.md', 'created while saving');
    expect(await live.disk('fresh.md')).toBe('created while saving');
    expect(await live.disk('notes.md')).toBe('start');

    release();
    await vi.waitFor(async () => expect(await live.disk('notes.md')).toBe('slow network save'));
    await vi.waitFor(() => expect(editor.session.hasUnpersistedChanges()).toBe(false));
    editor.session.dispose();
  }, 15000);
});
