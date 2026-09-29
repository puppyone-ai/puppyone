import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSessionController } from '../../../../src/features/desktop-agent/application/AgentSessionController';
import { agentSessionReplicaLimits } from '../../../../src/features/desktop-agent/application/AgentSessionReplica';
import { AgentOperationError } from '../../../../src/features/desktop-agent/application/agent-error';
import { createServiceHarness, createSender } from '../../../support/agent/agentServiceHarness.mjs';

const cleanup: Array<() => void | Promise<void>> = [];
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });

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
  it('does not dispatch an attach cancelled before its microtask starts', async () => {
    vi.useFakeTimers(); const h = await harness(); await h.controller.initialize();
    const before = h.bridge.attachAgentSession.mock.calls.length;
    const retry = h.controller.retryDisplayRecovery();
    h.controller.pauseDisplayRecovery();
    await retry;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.bridge.attachAgentSession).toHaveBeenCalledTimes(before);
    expect(h.controller.getSnapshot().displayRecovery?.policy).toBe('paused');
  });
  it('pauses retries and releases a late attach without resuming on initialize', async () => {
    vi.useFakeTimers(); const h = await harness(); await h.controller.initialize();
    const attach = h.bridge.attachAgentSession.getMockImplementation()!;
    const receipt = await attach({rootPath:'/workspace',sessionId:h.snapshot.session.id});
    let finish!: (value: typeof receipt) => void;
    h.bridge.attachAgentSession.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
    const repair = h.controller.retryDisplayRecovery();
    await vi.advanceTimersByTimeAsync(0);
    h.controller.pauseDisplayRecovery();
    await repair;
    finish(receipt);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.controller.getSnapshot().displayRecovery?.policy).toBe('paused');
    expect(h.bridge.attachAgentSession).toHaveBeenCalledTimes(2);
    expect(h.bridge.detachAgentSession).toHaveBeenCalledWith(expect.objectContaining({subscriptionId:receipt.subscriptionId}));
    expect(mainStartCount(h.main)).toBe(0);
    await h.controller.retryDisplayRecovery();
    expect(h.controller.getSnapshot().replicaStatus).toBe('live');
  });
  it('bounds automatic recovery attempts and permits an explicit retry', async () => {
    vi.useFakeTimers(); const h = await harness();
    const attach = h.bridge.attachAgentSession.getMockImplementation()!;
    h.bridge.attachAgentSession.mockRejectedValue(new Error('feed unavailable'));
    await h.controller.initialize();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(h.controller.getSnapshot().displayRecovery?.policy).toBe('exhausted');
    const attempts = h.bridge.attachAgentSession.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(h.bridge.attachAgentSession).toHaveBeenCalledTimes(attempts);
    h.bridge.attachAgentSession.mockImplementation(attach);
    await h.controller.retryDisplayRecovery();
    expect(h.controller.getSnapshot().replicaStatus).toBe('live');
    expect(mainStartCount(h.main)).toBe(0);
  });
  it('ends a missing runtime instance instead of retrying it as a history gap', async () => {
    vi.useFakeTimers(); const h = await harness(); await h.controller.initialize();
    h.bridge.readAgentSessionWatermark.mockRejectedValue(new AgentOperationError({
      schemaVersion: 1, code: 'SESSION_NOT_FOUND', message: 'The runtime instance has ended.', retryable: false, actions: [],
    }));
    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.watermarkIdleMs);
    expect(h.controller.getSnapshot()).toMatchObject({ replicaStatus: 'detached', error: { code: 'session-ended' } });
    const calls = h.bridge.attachAgentSession.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.bridge.attachAgentSession).toHaveBeenCalledTimes(calls);
    expect(h.bridge.readAgentSessionWatermark).toHaveBeenCalledOnce();
  });
  it.each(['attach', 'ack'] as const)('recovers an initial %s failure without sending another native command', async failure => {
    vi.useFakeTimers();
    const h = await harness();
    if (failure === 'attach') h.bridge.attachAgentSession.mockRejectedValueOnce(new Error('Temporary IPC failure'));
    else h.bridge.acknowledgeAgentSession.mockRejectedValueOnce(new Error('Temporary IPC failure'));
    await h.controller.initialize();
    expect(h.controller.getSnapshot().replicaStatus).toBe('stale');
    h.emit('turn.started');
    h.emit('assistant.completed', {text: 'Output while disconnected'}, 'answer');
    h.emit('turn.completed');
    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.watermarkIdleMs);
    expect(h.controller.getSnapshot().replicaStatus).toBe('live');
    expect(h.controller.getSnapshot().error).toBeNull();
    expect(h.controller.getSnapshot().projection).toEqual(h.read().display);
    expect(mainStartCount(h.main)).toBe(0);
  });
  it('recovers a timed out first attach and detaches its late receipt', async () => {
    vi.useFakeTimers(); const h = await harness();
    const attach = h.bridge.attachAgentSession.getMockImplementation()!;
    let late: ((receipt:any)=>void) | undefined;
    const receipt = await attach({rootPath:'/workspace',sessionId:h.snapshot.session.id});
    h.bridge.attachAgentSession.mockImplementationOnce(() => new Promise(resolve => {late=resolve;}));
    const initialized = h.controller.initialize();
    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.attachTimeoutMs); await initialized;
    expect(h.controller.getSnapshot().replicaStatus).toBe('stale');
    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.watermarkIdleMs);
    expect(h.controller.getSnapshot().replicaStatus).toBe('live');
    late?.(receipt); await vi.advanceTimersByTimeAsync(0);
    expect(h.bridge.detachAgentSession).toHaveBeenCalledWith(expect.objectContaining({subscriptionId:receipt.subscriptionId}));
    expect(mainStartCount(h.main)).toBe(0);
  });

  it('allows a slow snapshot to finish within the dedicated attach budget', async () => {
    vi.useFakeTimers();
    const h = await harness();
    const attach = h.bridge.attachAgentSession.getMockImplementation()!;
    h.bridge.attachAgentSession.mockImplementationOnce(request => new Promise(resolve => {
      setTimeout(() => resolve(attach(request)), 20_000);
    }));
    const initialized = h.controller.initialize();
    await vi.advanceTimersByTimeAsync(20_000);
    await initialized;
    expect(h.controller.getSnapshot().replicaStatus).toBe('live');
    expect(h.controller.getSnapshot().displayRecovery).toBeUndefined();
  });

  it('escalates recovery UI only after silent and compact reconnecting stages', async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.bridge.attachAgentSession.mockRejectedValue(new Error('Temporary IPC failure'));
    await h.controller.initialize();
    expect(h.controller.getSnapshot()).toMatchObject({
      replicaStatus: 'stale',
      displayRecovery: { stage: 'silent', cause: 'attach-failed' },
    });
    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.recoveryReconnectingDelayMs);
    expect(h.controller.getSnapshot().displayRecovery?.stage).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.recoveryDegradedDelayMs
      - agentSessionReplicaLimits.recoveryReconnectingDelayMs);
    expect(h.controller.getSnapshot()).toMatchObject({
      error: null,
      displayRecovery: { stage: 'degraded', cause: 'attach-failed' },
    });
  });

  it('keeps recovery status visible while a replacement snapshot is still attaching', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.controller.initialize();
    const attach = h.bridge.attachAgentSession.getMockImplementation()!;
    h.bridge.attachAgentSession.mockImplementationOnce(request => new Promise(resolve => {
      setTimeout(() => resolve(attach(request)), 20_000);
    }));
    h.setTransform(frame => ({ ...frame, displayPatch: { schemaVersion: 2 } }));
    h.emit('turn.started');
    h.setTransform(value => value);

    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.recoveryReconnectingDelayMs);
    expect(h.controller.getSnapshot()).toMatchObject({
      replicaStatus: 'stale',
      displayRecovery: { stage: 'reconnecting', cause: 'schema-invalid' },
    });
    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.recoveryDegradedDelayMs
      - agentSessionReplicaLimits.recoveryReconnectingDelayMs);
    expect(h.controller.getSnapshot().displayRecovery?.stage).toBe('degraded');
    await vi.advanceTimersByTimeAsync(20_000 - agentSessionReplicaLimits.recoveryDegradedDelayMs);
    expect(h.controller.getSnapshot().replicaStatus).toBe('live');
    expect(h.controller.getSnapshot().displayRecovery).toBeUndefined();
  });

  it('stops first-attach recovery after disposal', async () => {
    vi.useFakeTimers(); const h = await harness();
    h.bridge.attachAgentSession.mockRejectedValue(new Error('Unavailable'));
    await h.controller.initialize(); h.controller.dispose();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.bridge.attachAgentSession).toHaveBeenCalledTimes(1);
  });
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
    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.watermarkIdleMs);
    expect(h.bridge.attachAgentSession).toHaveBeenCalledTimes(2);
    expect(h.controller.getSnapshot().projection).toEqual(h.read().display);
    expect(h.controller.getSnapshot().phase).toBe('ready');
  });

  it('checks the watermark only after a full interval without frames', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.controller.initialize();
    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.watermarkIdleMs - 1_000);
    expect(h.bridge.readAgentSessionWatermark).not.toHaveBeenCalled();
    h.emit('turn.started');
    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.watermarkIdleMs - 1);
    expect(h.bridge.readAgentSessionWatermark).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.bridge.readAgentSessionWatermark).toHaveBeenCalledOnce();
  });

  it('coalesces a high-frequency frame burst into bounded acknowledgements', async () => {
    const h = await harness();
    await h.controller.initialize();
    const initialAcknowledgements = h.bridge.acknowledgeAgentSession.mock.calls.length;
    h.emit('turn.started');
    for (let index = 0; index < 400; index += 1) h.emit('assistant.delta', { delta: 'x' }, 'assistant-A');
    await vi.waitFor(() => {
      const request = h.bridge.acknowledgeAgentSession.mock.calls.at(-1)?.[0];
      expect(request?.revision).toBe(h.controller.getSnapshot().control?.revision);
    });
    expect(h.bridge.acknowledgeAgentSession.mock.calls.length).toBeLessThanOrEqual(initialAcknowledgements + 2);
    expect(h.controller.getSnapshot().projection).toEqual(h.read().display);
  });

  it('repairs one snapshot after a burst exceeds feed backpressure limits', async () => {
    const h = await harness();
    await h.controller.initialize();
    h.emit('turn.started');
    for (let index = 0; index < 1_200; index += 1) h.emit('assistant.delta', { delta: 'x' }, 'assistant-A');
    await vi.waitFor(() => {
      expect(h.controller.getSnapshot().replicaStatus).toBe('live');
      expect(h.controller.getSnapshot().projection).toEqual(h.read().display);
    });
    expect(h.bridge.attachAgentSession).toHaveBeenCalledTimes(2);
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

  it('resets the retry budget only after a sustained stable window', async () => {
    vi.useFakeTimers();
    const h = await harness();
    await h.controller.initialize();
    h.bridge.attachAgentSession.mockRejectedValueOnce(new Error('Temporary IPC failure'));
    h.setTransform(frame => ({ ...frame, displayPatch: { schemaVersion: 2 } }));
    h.emit('turn.started');
    h.setTransform(value => value);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.controller.getSnapshot().displayRecovery?.attempt).toBe(1);
    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.recoveryRetryBaseMs * 2);
    expect(h.controller.getSnapshot().replicaStatus).toBe('live');

    h.setTransform(frame => ({ ...frame, displayPatch: { schemaVersion: 2 } }));
    h.emit('assistant.delta', { delta: 'first recurrence' }, 'assistant-A');
    h.setTransform(value => value);
    expect(h.controller.getSnapshot().displayRecovery?.attempt).toBe(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.controller.getSnapshot().replicaStatus).toBe('live');

    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.recoveryStabilityWindowMs);
    h.setTransform(frame => ({ ...frame, displayPatch: { schemaVersion: 2 } }));
    h.emit('assistant.delta', { delta: 'after stable window' }, 'assistant-A');
    h.setTransform(value => value);
    expect(h.controller.getSnapshot().displayRecovery?.attempt).toBe(1);
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
    await vi.advanceTimersByTimeAsync(agentSessionReplicaLimits.watermarkIdleMs + agentSessionReplicaLimits.controlRequestTimeoutMs
      + agentSessionReplicaLimits.recoveryRetryBaseMs + 1);
    expect(h.bridge.attachAgentSession).toHaveBeenCalledTimes(2);
    expect(mainStartCount(h.main)).toBe(0);
  });
});
function mainStartCount(main: any) { return main.adapters.reduce((count: number, adapter: any) => count + adapter.startTurn.mock.calls.length, 0); }
