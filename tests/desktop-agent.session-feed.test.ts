import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSessionController } from '../src/features/desktop-agent/application/AgentSessionController';
import { createServiceHarness, createSender } from './helpers/agentServiceHarness.mjs';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); vi.useRealTimers(); });

async function harness() {
  const main = createServiceHarness();
  const owner = createSender(890);
  const rootPath = '/workspace';
  const snapshot = await main.service.createSession(owner, { runtimeId: 'codex' }, rootPath);
  let listener: ((value: any) => void) | null = null;
  let transform: (frame: any) => any = value => value;
  owner.send.mockImplementation((channel, frame) => { if (channel === 'agent:session-frame') { const value = transform(frame); if (value) listener?.(value); } });
  const bridge = {
    discoverAgentRuntimes: vi.fn(request => main.service.discoverProviders(owner, { ...request, runtimeId: 'codex' }, rootPath)),
    resumeAgentSession: vi.fn(async () => snapshot),
    attachAgentSession: vi.fn(request => Promise.resolve(main.service.attachSession(owner, request, rootPath))),
    acknowledgeAgentSession: vi.fn(request => Promise.resolve(main.service.acknowledgeSession(owner, request, rootPath))),
    readAgentSessionWatermark: vi.fn(request => Promise.resolve(main.service.readSessionWatermark(owner, request, rootPath))),
    detachAgentSession: vi.fn(request => Promise.resolve(main.service.detachSession(owner, request, rootPath))),
    onAgentSessionFrame: vi.fn(callback => { listener = callback; return () => { listener = null; }; }),
  };
  const controller = new AgentSessionController(rootPath, () => bridge as never);
  cleanup.push(() => controller.dispose(), () => main.service.closeAll());
  return { main, bridge, controller, snapshot, setTransform: (fn: typeof transform) => { transform = fn; },
    emit: (type: string, payload = {}, itemId: string | null = null, turnId = 'turn-A') => main.adapters[0].emit({ type, payload, itemId, turnId, providerSessionId: 'thread-1' }),
    read: () => main.service.replay(owner, { sessionId: snapshot.session.id, afterSequence: 0 }, rootPath),
  };
}

describe('Renderer display replica against the Main SessionActor and feed', () => {
  it('applies frames emitted between snapshot creation and initial ACK exactly once', async () => {
    const h = await harness();
    const attach = h.bridge.attachAgentSession.getMockImplementation()!;
    h.bridge.attachAgentSession.mockImplementationOnce(async request => {
      const receipt = await attach(request);
      h.emit('turn.started', { prompt: 'Hello', userMessageId: 'client-A' });
      h.emit('assistant.delta', { delta: 'Hi' }, 'assistant-A');
      return receipt;
    });
    await h.controller.initialize();
    expect(h.controller.getSnapshot()).toMatchObject({ phase: 'running', replicaStatus: 'live' });
    expect(h.controller.getSnapshot().projection).toEqual(h.read().display);
    expect(h.controller.getSnapshot().projection.messages.map(message => message.text)).toEqual(['Hello', 'Hi']);
  });

  it('keeps same-text submissions distinct while joining native echo by client identity', async () => {
    const h = await harness(); await h.controller.initialize();
    h.emit('turn.started', { prompt: 'Hello', userMessageId: 'client-A' });
    h.emit('user.message', { text: 'Hello', clientUserMessageId: 'client-A' }, 'native-A');
    h.emit('turn.completed');
    h.emit('turn.started', { prompt: 'Hello', userMessageId: 'client-B' }, null, 'turn-B');
    expect(h.controller.getSnapshot().projection.messages).toHaveLength(2);
    expect(h.controller.getSnapshot().projection).toEqual(h.read().display);
  });

  it('does not clear a model retry when a tool progresses, and clears it on native completion', async () => {
    const h = await harness(); await h.controller.initialize();
    h.emit('turn.started');
    h.emit('provider.connection.updated', { state: 'reconnecting', message: 'Retrying', attempt: 1, maxAttempts: 3 });
    h.emit('tool.progress', { label: 'Read', status: 'running' }, 'tool-A');
    expect(h.controller.getSnapshot().projection.connectionStatus?.message).toBe('Retrying');
    expect(h.controller.getSnapshot().control?.connection.status).toBe('connected');
    h.emit('turn.completed');
    expect(h.controller.getSnapshot().projection.connectionStatus).toBeNull();
    expect(h.controller.getSnapshot().projection).toEqual(h.read().display);
  });

  it('repairs a lost last terminal frame using the watermark', async () => {
    vi.useFakeTimers(); const h = await harness(); await h.controller.initialize();
    h.emit('turn.started');
    h.setTransform(() => null); h.emit('turn.completed'); h.setTransform(value => value);
    expect(h.controller.getSnapshot().projection.runningTurnId).toBe('turn-A');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.bridge.attachAgentSession).toHaveBeenCalledTimes(2);
    expect(h.controller.getSnapshot().projection).toEqual(h.read().display);
    expect(h.controller.getSnapshot().phase).toBe('ready');
  });

  it('does not ACK a malformed patch and repairs from a fresh snapshot', async () => {
    const h = await harness(); await h.controller.initialize();
    const initialCalls = h.bridge.acknowledgeAgentSession.mock.calls.length;
    h.setTransform(frame => ({ ...frame, displayPatch: { schemaVersion: 2 } }));
    h.emit('turn.started'); h.setTransform(value => value);
    await vi.waitFor(() => expect(h.controller.getSnapshot().replicaStatus).toBe('live'));
    expect(h.bridge.attachAgentSession).toHaveBeenCalledTimes(2);
    expect(h.bridge.acknowledgeAgentSession.mock.calls.length).toBe(initialCalls + 1);
    expect(h.controller.getSnapshot().projection).toEqual(h.read().display);
  });

  it('ignores duplicate frames without appending their text again', async () => {
    const h = await harness(); await h.controller.initialize();
    let last: any; h.setTransform(frame => { last = frame; return frame; });
    h.emit('turn.started'); h.emit('assistant.delta', { delta: 'Hello' }, 'assistant-A');
    h.bridge.onAgentSessionFrame.mock.calls[0][0](last);
    expect(h.controller.getSnapshot().projection.messages.map(message => message.text)).toEqual(['Hello']);
  });

  it('isolates a faulty view subscriber from the committed display and subsequent frames', async () => {
    const h = await harness(); await h.controller.initialize();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.controller.subscribe(() => { throw new Error('view failure'); });
    h.emit('turn.started'); h.emit('assistant.delta', { delta: 'Hello' }, 'assistant-A'); h.emit('turn.completed');
    expect(h.controller.getSnapshot().projection).toEqual(h.read().display);
    expect(h.controller.getSnapshot().phase).toBe('ready'); log.mockRestore();
  });

  it('keeps the replica stale when a fresh attachment cannot be acknowledged', async () => {
    vi.useFakeTimers(); const h = await harness(); await h.controller.initialize();
    h.bridge.acknowledgeAgentSession.mockImplementationOnce(async () => ({synchronized:false} as never));
    h.setTransform(frame => ({...frame, displayPatch:{schemaVersion:2}}));
    h.emit('turn.started'); h.setTransform(value=>value);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.controller.getSnapshot().replicaStatus).toBe('stale');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.controller.getSnapshot().replicaStatus).toBe('live');
    expect(h.controller.getSnapshot().projection).toEqual(h.read().display);
    expect(mainStartCount(h.main)).toBe(0);
  });

  it('bounds a stalled watermark read and retries attachment without native side effects', async () => {
    vi.useFakeTimers(); const h = await harness(); await h.controller.initialize();
    h.bridge.readAgentSessionWatermark.mockImplementationOnce(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(13_000);
    expect(h.bridge.attachAgentSession).toHaveBeenCalledTimes(2);
    expect(mainStartCount(h.main)).toBe(0);
  });
});
function mainStartCount(main: any) { return main.adapters.reduce((count: number, adapter: any) => count + adapter.startTurn.mock.calls.length, 0); }
