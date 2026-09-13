import { applyAgentDisplayPatch } from '../../../../shared/agent-contract/display-state.mjs';
import { assertAgentDisplay } from '../../../../shared/agent-contract/display-schema.mjs';
import { assertAgentSessionFrame, assertAgentSessionSnapshot } from '../../../../shared/agent-contract/schema.mjs';
import type { AgentSessionFrame, AgentSessionSnapshot } from '../domain/agent-contract';
import type { AgentControllerState } from './agent-controller-state';
import { AgentKnownError, AgentOperationError, createAgentError } from './agent-error';
import type { AgentClientPort, AgentClientProvider } from './AgentClientPort';

type StatePatch = (patch: Partial<AgentControllerState>) => void;
const WATERMARK_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 8_000;

/** A disposable replica of the session service's display JSON. It never interprets Harness events. */
export class AgentSessionReplica {
  private frameCleanup: (() => void) | null = null;
  private failureCleanup: (() => void) | null = null;
  private connectedBridge: AgentClientPort | null = null;
  private subscription: { id: string; sessionId: string; instanceId?: string; streamId: string; revision: number; epoch: number } | null = null;
  private epoch = 0;
  private repairPromise: Promise<void> | null = null;
  private watermarkTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private ended = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly bridgeProvider: AgentClientProvider,
    private readonly readState: () => AgentControllerState,
    private readonly patch: StatePatch,
  ) {}

  connect() {
    if (this.disposed) return;
    const bridge = this.bridgeProvider();
    if (!bridge || bridge === this.connectedBridge) return;
    this.frameCleanup?.();
    this.failureCleanup?.();
    this.invalidate();
    this.connectedBridge = bridge;
    this.frameCleanup = bridge.onAgentSessionFrame?.(frame => this.handleFrame(frame)) ?? null;
    this.failureCleanup = bridge.onAgentSessionFailure?.(message => {
      ++this.epoch;
      this.ended = true;
      this.subscription = null;
      if (this.watermarkTimer) clearTimeout(this.watermarkTimer);
      this.watermarkTimer = null;
      this.patch({ phase: 'runtime-exited', replicaStatus: 'detached', error: { code: 'unknown', detail: message } });
    }) ?? null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidate();
    this.frameCleanup?.();
    this.frameCleanup = null;
    this.failureCleanup?.();
    this.failureCleanup = null;
    this.connectedBridge = null;
  }

  private invalidate() {
    ++this.epoch;
    const previous = this.subscription;
    this.subscription = null;
    if (this.watermarkTimer) clearTimeout(this.watermarkTimer);
    this.watermarkTimer = null;
    if (previous) this.detach(this.connectedBridge, previous.sessionId, previous.id, previous.instanceId);
  }

  private detach(bridge: AgentClientPort | null, sessionId: string, subscriptionId: string, instanceId?: string) {
    void bridge?.detachAgentSession?.({ rootPath: this.workspaceRoot, sessionId, subscriptionId, ...(instanceId ? { instanceId } : {}) }).catch(() => {});
  }

  async attachSession(sessionId: string): Promise<AgentSessionSnapshot | null> {
    this.ended = false;
    this.connect();
    const bridge = this.connectedBridge;
    if (!bridge?.attachAgentSession || !bridge.acknowledgeAgentSession || !bridge.onAgentSessionFrame) {
      throw new Error('The native Agent display feed is unavailable.');
    }
    this.invalidate();
    const epoch = this.epoch;
    const instanceId = this.readState().session?.id === sessionId ? this.readState().session?.instanceId : undefined;
    this.patch({ replicaStatus: 'subscribing' });
    let timedOut = false;
    const attach = bridge.attachAgentSession.bind(bridge);
    const pending = Promise.resolve().then(() => attach({ rootPath: this.workspaceRoot, sessionId, ...(instanceId ? { instanceId } : {}) }));
    // An expired attach can still create a Main subscription; release its late receipt.
    void pending.then(receipt => {
      if (timedOut || this.disposed || epoch !== this.epoch) this.detach(bridge, sessionId, receipt.subscriptionId, instanceId);
    }, () => {});
    let receipt;
    try { receipt = await withTimeout(pending); }
    catch (error) {
      timedOut = true;
      if (this.disposed || epoch !== this.epoch) return null;
      if (this.handleEnded(error)) throw new AgentKnownError('session-ended');
      this.subscriptionFailed(epoch);
      throw new AgentKnownError('event-gap');
    }
    if (this.disposed || epoch !== this.epoch) return null;
    try {
      const snapshot = assertAgentSessionSnapshot(receipt.snapshot);
      if (snapshot.session.id !== sessionId || !snapshot.cursor || !snapshot.control) throw new Error('Invalid Agent display snapshot.');
      this.subscription = { id: receipt.subscriptionId, sessionId, instanceId: snapshot.session.instanceId, ...snapshot.cursor, epoch };
      return snapshot;
    } catch (error) {
      this.detach(bridge, sessionId, receipt.subscriptionId, instanceId);
      this.subscriptionFailed(epoch);
      throw new AgentKnownError('event-gap');
    }
  }

  async activateSessionFeed(sessionId: string) {
    const subscription = this.subscription;
    if (!subscription || subscription.sessionId !== sessionId) return false;
    try {
      const synchronized = await this.acknowledge(subscription);
      if (this.current(subscription)) this.patch({ replicaStatus: synchronized ? 'live' : 'stale' });
      return synchronized && this.current(subscription);
    } catch (error) {
      if (!this.current(subscription)) return false;
      if (this.handleEnded(error)) return false;
      this.subscriptionFailed(subscription.epoch);
      return false;
    } finally {
      if (this.current(subscription)) this.scheduleWatermarkCheck();
    }
  }

  private subscriptionFailed(epoch: number) {
    if (this.disposed || this.ended || epoch !== this.epoch) return;
    this.patch({ replicaStatus: 'stale', error: createAgentError('event-gap') });
    this.scheduleWatermarkCheck();
  }

  repairFrom(_afterSequence?: number) {
    if (this.disposed || this.ended) return Promise.resolve();
    if (this.repairPromise) return this.repairPromise;
    const sessionId = this.readState().session?.id;
    if (!sessionId) return Promise.resolve();
    this.patch({ replicaStatus: 'stale' });
    this.repairPromise = (async () => {
      let repairEpoch = this.epoch;
      try {
        const pending = this.attachSession(sessionId);
        repairEpoch = this.epoch;
        const snapshot = await pending;
        if (!snapshot || this.disposed || this.readState().session?.id !== sessionId) return;
        this.patch({ session: snapshot.session, control: snapshot.control!, projection: snapshot.display });
        const synchronized = await this.activateSessionFeed(sessionId);
        if (synchronized && !this.disposed && this.readState().session?.id === sessionId) this.patch({ replicaStatus: 'live',
          ...(this.readState().error?.code === 'event-gap' ? { error: null } : {}),
        });
      } catch (error) {
        if (this.disposed || this.epoch !== repairEpoch) return;
        if (this.handleEnded(error)) return;
        if (!this.disposed && this.epoch === repairEpoch && this.readState().session?.id === sessionId) this.patch({ replicaStatus: 'stale', error: createAgentError('event-gap') });
      }
    })().finally(() => {
      this.repairPromise = null;
      this.scheduleWatermarkCheck();
    });
    return this.repairPromise;
  }

  private handleFrame(input: AgentSessionFrame) {
    const subscription = this.subscription;
    if (!subscription || !this.current(subscription) || input.subscriptionId !== subscription.id) return;
    try {
      const frame = assertAgentSessionFrame(input);
      if (frame.streamId !== subscription.streamId || frame.type === 'resync-required') { void this.repairFrom(); return; }
      if (frame.revision <= subscription.revision) return;
      if (frame.baseRevision !== subscription.revision || frame.session.id !== subscription.sessionId) { void this.repairFrom(); return; }
      const projection = assertAgentDisplay(applyAgentDisplayPatch(this.readState().projection, frame.displayPatch));
      // Validate and publish the complete transaction before moving the cursor or ACKing it.
      this.patch({ projection, control: frame.control, session: frame.session });
      if (frame.control.connection.reason === 'session-closed') { this.endInstance(); return; }
      subscription.revision = frame.revision;
      void this.acknowledge(subscription).catch(() => { if (this.current(subscription)) void this.repairFrom(); });
    } catch {
      this.patch({ replicaStatus: 'stale', error: createAgentError('event-gap') });
      void this.repairFrom();
    }
  }

  private current(subscription: NonNullable<AgentSessionReplica['subscription']>) {
    return !this.disposed && this.subscription === subscription && subscription.epoch === this.epoch
      && this.readState().session?.id === subscription.sessionId;
  }

  private async acknowledge(subscription: NonNullable<AgentSessionReplica['subscription']>) {
    const bridge = this.connectedBridge;
    if (!bridge?.acknowledgeAgentSession) throw new Error('The Agent display feed cannot acknowledge changes.');
    const result = await withTimeout(bridge.acknowledgeAgentSession({
      rootPath: this.workspaceRoot, sessionId: subscription.sessionId, subscriptionId: subscription.id,
      ...(subscription.instanceId ? { instanceId: subscription.instanceId } : {}),
      streamId: subscription.streamId, revision: subscription.revision,
    }));
    if (this.current(subscription) && !result.synchronized) {
      this.patch({ replicaStatus: 'stale' });
      void this.repairFrom();
    }
    return result.synchronized === true;
  }

  private scheduleWatermarkCheck() {
    if (this.disposed || this.ended || this.watermarkTimer || !this.readState().session) return;
    this.watermarkTimer = setTimeout(() => { this.watermarkTimer = null; void this.checkWatermark(); }, WATERMARK_INTERVAL_MS);
  }

  private async checkWatermark() {
    const subscription = this.subscription;
    const bridge = this.connectedBridge;
    try {
      if (!subscription || !this.current(subscription) || this.readState().replicaStatus === 'stale' || !bridge?.readAgentSessionWatermark) {
        await this.repairFrom(); return;
      }
      const watermark = await withTimeout(bridge.readAgentSessionWatermark({
        rootPath: this.workspaceRoot, sessionId: subscription.sessionId, subscriptionId: subscription.id,
        ...(subscription.instanceId ? { instanceId: subscription.instanceId } : {}),
      }));
      if (!this.current(subscription)) return;
      // Frames may advance while this read is in flight. A lower watermark is harmless.
      if (watermark.resyncRequired || watermark.streamId !== subscription.streamId || watermark.revision > subscription.revision) await this.repairFrom();
    } catch (error) {
      if (subscription && !this.current(subscription)) return;
      if (this.handleEnded(error)) return;
      if (!subscription || this.current(subscription)) await this.repairFrom();
    } finally { this.scheduleWatermarkCheck(); }
  }

  private handleEnded(error: unknown) {
    const code = error instanceof AgentOperationError ? error.failure.code : error instanceof AgentKnownError ? error.code : null;
    if (!code || !['SESSION_NOT_FOUND', 'SESSION_STALE', 'PROJECT_STALE', 'PROJECT_CLOSING', 'session-ended'].includes(code)) return false;
    this.endInstance();
    return true;
  }

  private endInstance() {
    this.ended = true;
    this.invalidate();
    this.patch({ phase: 'runtime-exited', replicaStatus: 'detached', error: createAgentError('session-ended') });
  }
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Agent display synchronization timed out.')), REQUEST_TIMEOUT_MS);
  })]).finally(() => clearTimeout(timer));
}

export const agentSessionReplicaLimits = Object.freeze({ watermarkIntervalMs: WATERMARK_INTERVAL_MS, requestTimeoutMs: REQUEST_TIMEOUT_MS });
