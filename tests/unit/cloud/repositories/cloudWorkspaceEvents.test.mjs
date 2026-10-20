import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { readCloudWorkspaceEvents, registerCloudWorkspaceEvents } from '../../../../electron/main/cloud-workspace-events.mjs';

function response(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }),
    { headers: { 'Content-Type': 'text/event-stream' } });
}
describe('workspace file events', () => {
  it('decodes split UTF-8 frames and heartbeats without requiring Agent cursors', async () => {
    const emit = vi.fn();
    await readCloudWorkspaceEvents(response([': keepalive\r\n\r\nevent: cha', 'nge\ndata: {"generation":"one","reset":true}\n\n',
      ': keepalive\n\nevent: unavailable\ndata: {}\n\n']), emit);
    expect(emit.mock.calls).toEqual([[{ type: 'change', generation: 'one' }], [{ type: 'unavailable' }]]);
  });
  it('rejects malformed, oversized and prematurely closed streams', async () => {
    await expect(readCloudWorkspaceEvents(response(['event: change\ndata: {}\n\n']), vi.fn())).rejects.toThrow(/Invalid/);
    await expect(readCloudWorkspaceEvents(response(['a'.repeat(32769)]), vi.fn())).rejects.toThrow(/limit/);
    await expect(readCloudWorkspaceEvents(response([': heartbeat\n\n']), vi.fn())).rejects.toThrow(/closed/);
  });
  it('owns subscriptions by window and stops transport on window close or explicit release', async () => {
    const handlers = new Map();
    const owner = Object.assign(new EventEmitter(), { id: 5, send: vi.fn(), isDestroyed: () => false });
    let emit, signal;
    const auth = { readSession: async () => ({ user_id: 'actor', session_generation: 'session', api_base_url: 'https://cloud-fixture.puppyone.ai/api/v1' }),
      requestSessionApi: vi.fn(async (_base, _path, options) => {
        emit = options.onWorkspaceEvent; signal = options.signal;
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      }) };
    registerCloudWorkspaceEvents({ handle: (name, handler) => handlers.set(name, handler) }, auth);
    const input = { id: 'subscription', projectId: 'project', generation: 'one', apiBaseUrl: 'https://cloud-fixture.puppyone.ai/api/v1',
      expectedSession: { userId: 'actor', generation: 'session' } };
    await handlers.get('cloud-workspace:watch')({ sender: owner }, input);
    await emit({ type: 'change', generation: 'one' });
    expect(owner.send).toHaveBeenCalledWith('cloud-workspace:event', { id: 'subscription', type: 'change', generation: 'one' });
    handlers.get('cloud-workspace:stop')({ sender: { id: 8 } }, { id: input.id }); expect(signal.aborted).toBe(false);
    handlers.get('cloud-workspace:stop')({ sender: owner }, { id: input.id }); expect(signal.aborted).toBe(true);
    await vi.waitFor(() => expect(owner.listenerCount('destroyed')).toBe(0));
    await handlers.get('cloud-workspace:watch')({ sender: owner }, { ...input, id: 'next' });
    owner.emit('destroyed'); expect(signal.aborted).toBe(true);
  });
  it('drops late events after an account change', async () => {
    const handlers = new Map(), owner = Object.assign(new EventEmitter(), { id: 5, send: vi.fn(), isDestroyed: () => false });
    let emit, signal;
    const auth = { readSession: async () => null, requestSessionApi: async (_base, _path, options) => {
      emit = options.onWorkspaceEvent; signal = options.signal;
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    } };
    registerCloudWorkspaceEvents({ handle: (name, handler) => handlers.set(name, handler) }, auth);
    await handlers.get('cloud-workspace:watch')({ sender: owner }, { id: 'test', projectId: 'project', generation: 'one',
      apiBaseUrl: 'https://cloud-fixture.puppyone.ai/api/v1', expectedSession: { userId: 'actor', generation: 'session' } });
    await emit({ type: 'change', generation: 'one' });
    expect(owner.send).not.toHaveBeenCalled(); expect(signal.aborted).toBe(true);
  });
});
