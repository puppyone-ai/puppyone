/** @vitest-environment happy-dom */
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createCloudDataService } from '../../../../src/features/cloud/files/cloudDataPort';
import { registerCloudIpcHandlers } from '../../../../electron/main/ipc/cloud-ipc.mjs';
import { requestCloudApi } from '../../../../electron/main/cloud-api-client.mjs';
import type { DesktopCloudSession } from '../../../../src/lib/cloudApi';
import { liveWorkbench, liveFile, liveEntry, fileRevision } from '../../../fixtures/cloud/repositories/liveWorkspace';

it('round-trips real Bash changes through HTTP, Main IPC, file events and the desktop DataPort before Git publication', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'desktop-live-workspace-'));
  const streams = new Set<ServerResponse>();
  const workspace = liveWorkbench();
  const requests: string[] = [];
  let pauses = 0;
  const sendChange = () => { for (const stream of streams) stream.write(`event: change\ndata: ${JSON.stringify({generation: workspace.generation, reset: true})}\n\n`); };
  const watcher = watch(directory, sendChange);
  let watcherError: Error | null = null;
  watcher.on('error', error => { watcherError = error; });
  await writeFile(path.join(directory, 'notes.md'), 'before');
  const server = createServer(async (request, response) => {
    try {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', '*');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
      const url = new URL(request.url!, 'http://localhost'), resource = url.searchParams.get('path') ?? '';
      requests.push(`${request.method} ${url.pathname}`);
      if (resource.includes('/') || resource === '..') { response.writeHead(400).end(); return; }
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname.endsWith('/workbench')) {
        if (request.method === 'POST') { workspace.state = 'running'; pauses++; response.end(JSON.stringify(workspace)); }
        else response.end(JSON.stringify({workspace}));
        return;
      }
      if (workspace.state !== 'running' || url.searchParams.get('generation') !== workspace.generation) {
        response.writeHead(409).end(JSON.stringify({detail: {code: 'workbench_not_running'}})); return;
      }
      if (url.pathname.endsWith('/events')) {
        response.setHeader('Content-Type', 'text/event-stream'); response.flushHeaders(); streams.add(response); sendChange();
        response.on('close', () => streams.delete(response)); return;
      }
      if (url.pathname.endsWith('/files')) {
        const names = await readdir(directory); response.end(JSON.stringify({ entries: names.map(name => liveEntry(name)) })); return;
      }
      const filename = path.join(directory, resource);
      if (request.method === 'PUT') {
        let data = ''; for await (const chunk of request) data += chunk;
        const body = JSON.parse(data), before = await readFile(filename);
        if (fileRevision(before) !== body.expected_revision) { response.writeHead(409).end('{}'); return; }
        const bytes = Buffer.from(body.content_base64, 'base64'); await writeFile(filename, bytes);
        response.end(JSON.stringify({revision: fileRevision(bytes)})); return;
      }
      response.end(JSON.stringify(liveFile(resource, await readFile(filename))));
    } catch (error) { response.writeHead(500).end(JSON.stringify({message: String(error)})); }
  });
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); }
  catch (error) { watcher.close(); await rm(directory, {recursive: true, force: true}); throw error; }
  const address = server.address() as {port: number}, apiBaseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const session: DesktopCloudSession = { user_id: 'actor', user_email: 'fixture@example.com', api_base_url: apiBaseUrl,
    session_generation: 'session', status: 'authenticated', expires_at: Date.now() + 3600000, expires_in: 3600 };
  const handlers = new Map<string, (...args: any[]) => any>();
  const events = new EventEmitter();
  const owner = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false,
    send: (channel: string, value: unknown) => events.emit(channel, value) });
  const auth = { readSession: async () => session, requestSessionApi: requestCloudApi };
  registerCloudIpcHandlers({ ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) }, cloudAuthService: auth });
  const original = window.puppyoneDesktop;
  window.puppyoneDesktop = {
    requestCloudSessionApi: (input: unknown) => handlers.get('cloud:session-api-request')!({sender: owner}, input),
    watchCloudWorkspace: (input: unknown) => handlers.get('cloud-workspace:watch')!({sender: owner}, input),
    stopCloudWorkspaceWatch: async (input: unknown) => handlers.get('cloud-workspace:stop')!({sender: owner}, input),
    onCloudWorkspaceEvent: (listener: (event: unknown) => void) => { events.on('cloud-workspace:event', listener); return () => { events.off('cloud-workspace:event', listener); }; },
  } as unknown as NonNullable<typeof window.puppyoneDesktop>;
  let stop: (() => void) | undefined;
  try {
    const service = createCloudDataService({apiBaseUrl, session, context: {status: 'resolved', projectId: 'project', projectName: 'Fixture',
      target: {kind: 'project_root', project_id: 'project'}, capabilities: ['content.read', 'content.write']} });
    const originalFile = await service.dataPort.readFile!('notes.md');
    const updated = vi.fn(), failed = vi.fn(); stop = service.watch!(updated, failed);
    await vi.waitFor(() => expect(updated).toHaveBeenCalled()); updated.mockClear();
    const started = performance.now();
    await promisify(execFile)('/bin/bash', ['-c', 'printf "%s" "agent uncommitted" > notes.md'], {cwd: directory});
    await vi.waitFor(() => expect(updated).toHaveBeenCalled());
    expect((await service.dataPort.readFile!('notes.md')).content).toBe('agent uncommitted');
    expect(performance.now() - started).toBeLessThan(5000);
    const stale = await service.dataPort.documentPersistence!.persist({path: 'notes.md', content: 'old browser draft',
      baseVersion: originalFile.version!, revision: '1', reason: 'edit'});
    expect(stale).toMatchObject({ok: false, kind: 'conflict', content: 'agent uncommitted'});
    const current = await service.dataPort.readFile!('notes.md');
    expect(await service.dataPort.documentPersistence!.persist({path: 'notes.md', content: 'editor saved',
      baseVersion: current.version!, revision: '2', reason: 'edit'})).toMatchObject({ok: true});
    expect((await promisify(execFile)('/bin/bash', ['-c', 'cat notes.md'], {cwd: directory})).stdout).toBe('editor saved');
    workspace.state = 'paused';
    for (const stream of streams) { stream.write('event: unavailable\ndata: {}\n\n'); stream.end(); }
    await vi.waitFor(() => expect(failed).toHaveBeenCalled());
    expect(pauses).toBe(0); await service.resume!(); expect(pauses).toBe(1);
    expect((await service.dataPort.readFile!('notes.md')).content).toBe('editor saved');
    expect(requests.every(value => value.includes('/workbench'))).toBe(true);
    expect(watcherError).toBeNull();
    expect(await readdir(directory)).toEqual(['notes.md']);
  } finally {
    stop?.(); owner.emit('destroyed'); window.puppyoneDesktop = original; watcher.close();
    for (const stream of streams) stream.destroy(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, {recursive: true, force: true});
  }
}, 15000);
