import { setTimeout as delay } from 'node:timers/promises';
import { normalizeCloudApiBaseUrl as normalizeCloudApiBase } from '../../shared/cloudEndpoint.js';
import { requireNonEmptyString } from './security.mjs';

/** Workspace SSE has generation resets, not Agent run cursors. */
export async function readCloudWorkspaceEvents(response, emit) {
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('Invalid Cloud file event stream.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('Cloud file connection closed.');
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.length > 32768) throw new Error('Cloud file event exceeds the transport limit.');
      while (buffer.includes('\n\n')) {
        const end = buffer.indexOf('\n\n');
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const event = parseWorkspaceEvent(frame);
        if (event) await emit(event);
        if (event?.type === 'unavailable') return;
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function parseWorkspaceEvent(frame) {
  let type = 'message'; const data = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (type === 'unavailable') {
    if (data.length && JSON.parse(data.join('\n')).retryable === true) throw new Error('Cloud file connection interrupted.');
    return { type };
  }
  if (type !== 'change') return null;
  const value = JSON.parse(data.join('\n'));
  if (typeof value.generation !== 'string' || value.reset !== true) throw new Error('Invalid Cloud file notification.');
  return { type, generation: value.generation };
}

export function registerCloudWorkspaceEvents(ipcMain, auth, { retryDelays = [250, 1000, 3000], wait = delay } = {}) {
  const subscriptions = new Map();
  ipcMain.handle('cloud-workspace:watch', async (event, input) => {
    const owner = event.sender;
    const id = requireNonEmptyString(input?.id, 'Subscription ID is required.');
    const project = requireNonEmptyString(input?.projectId, 'Project ID is required.');
    const generation = requireNonEmptyString(input?.generation, 'Workspace generation is required.');
    if (![id, project, generation].every(value => /^[a-zA-Z0-9-]{1,100}$/.test(value))) throw new Error('Invalid Cloud file subscription.');
    const apiBase = normalizeCloudApiBase(input.apiBaseUrl);
    if (!apiBase) throw new Error('Cloud API base URL is required.');
    const expectedSession = { userId: requireNonEmptyString(input?.expectedSession?.userId, 'Account is required.'),
      generation: requireNonEmptyString(input?.expectedSession?.generation, 'Session generation is required.') };
    const key = `${owner.id}:${id}`;
    if (subscriptions.has(key) || subscriptions.size >= 128) throw new Error('Cloud file subscription limit reached.');
    const controller = new AbortController();
    const close = () => { controller.abort(); subscriptions.delete(key); owner.removeListener('destroyed', close); };
    subscriptions.set(key, close); owner.once('destroyed', close);
    const send = async value => {
      if (controller.signal.aborted || owner.isDestroyed()) return;
      const session = await auth.readSession();
      if (session?.user_id !== expectedSession.userId || session?.session_generation !== expectedSession.generation
        || normalizeCloudApiBase(session?.api_base_url) !== apiBase) { close(); return; }
      if (value.type === 'change' && value.generation !== generation) throw new Error('Cloud workspace generation changed.');
      owner.send('cloud-workspace:event', { ...value, id });
    };
    void (async () => {
      try {
        for (let attempt = 0; !controller.signal.aborted; attempt++) {
          try {
            await auth.requestSessionApi(apiBase, `/projects/${encodeURIComponent(project)}/workbench/events?generation=${encodeURIComponent(generation)}`,
              { method: 'GET', responseType: 'workspace-events', onWorkspaceEvent: send, signal: controller.signal }, expectedSession);
            // An explicit unavailable event is terminal (pause/revocation/generation).
            return;
          } catch (error) {
            if (controller.signal.aborted) return;
            const status = Number(error?.status);
            if ((status >= 400 && status < 500 && status !== 429) || attempt >= retryDelays.length) throw error;
            await send({ type: 'reconnecting' });
            // GET only: reconnect never allocates, resumes compute or repeats a save.
            await wait(retryDelays[attempt], undefined, { signal: controller.signal });
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) await send({ type: 'unavailable', message: error instanceof Error ? error.message : String(error) });
      } finally { close(); }
    })().catch(() => close());
    return { id };
  });
  ipcMain.handle('cloud-workspace:stop', (event, input) => { subscriptions.get(`${event.sender.id}:${input?.id}`)?.(); });
}
