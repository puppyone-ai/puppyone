import { applyAgentDisplayPatch } from '../../../../shared/agent-contract/display-state.mjs';
import { assertAgentDisplay } from '../../../../shared/agent-contract/display-schema.mjs';
import { assertAgentSessionFrame, assertAgentSessionSnapshot } from '../../../../shared/agent-contract/schema.mjs';
import type { AgentSessionFrame, AgentSessionSnapshot } from '../domain/agent-contract';
import type { AgentControllerState, AgentDisplayRecoveryCause, AgentDisplayRecoveryStage } from './agent-controller-state';
import { AgentKnownError, AgentOperationError } from './agent-error';
import type { AgentClientPort, AgentClientProvider } from './AgentClientPort';
import {
  ManagedOperationScope,
  ScopedOperationTimeoutError,
  waitForScopedOperation,
} from '../../session-transport/ManagedOperationScope';

type StatePatch = (patch: Partial<AgentControllerState>) => void;
type Subscription = {
  id: string;
  sessionId: string;
  instanceId?: string;
  streamId: string;
  revision: number;
  acknowledgedRevision: number | null;
  ackPromise: Promise<boolean> | null;
  epoch: number;
};

const WATERMARK_IDLE_MS = 10_000;
const ATTACH_TIMEOUT_MS = 30_000;
const CONTROL_REQUEST_TIMEOUT_MS = 8_000;
const RECOVERY_RECONNECTING_DELAY_MS = 750;
const RECOVERY_DEGRADED_DELAY_MS = 10_000;
const RECOVERY_STABILITY_WINDOW_MS = 30_000;
const RECOVERY_RETRY_BASE_MS = 1_000;
const RECOVERY_RETRY_MAX_MS = 16_000;
const MAX_RECOVERY_ATTEMPTS = 5;

/** A disposable replica of the session service's display JSON. It never interprets Harness events. */
export class AgentSessionReplica {
  private frameCleanup: (() => void) | null = null;
  private failureCleanup: (() => void) | null = null;
  private connectedBridge: AgentClientPort | null = null;
  private subscription: Subscription | null = null;
  private epoch = 0;
  private repairPromise: Promise<void> | null = null;
  private watermarkTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectingTimer: ReturnType<typeof setTimeout> | null = null;
  private degradedTimer: ReturnType<typeof setTimeout> | null = null;
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryStartedAt: number | null = null;
  private recoveryCause: AgentDisplayRecoveryCause | null = null;
  private lastSnapshotItems = 0;
  private disposed = false;
  private ended = false;
  private paused = false;
  private attempts = 0;
  private scope = new ManagedOperationScope();

  constructor(
    private readonly workspaceRoot: string,
    private readonly bridgeProvider: AgentClientProvider,
    private readonly readState: () => AgentControllerState,
    private readonly patch: StatePatch,
  ) {}

  connect() {
    if (this.disposed || this.paused) return;
    const bridge = this.bridgeProvider();
    if (!bridge || bridge === this.connectedBridge) return;
    this.frameCleanup?.();
    this.failureCleanup?.();
    this.invalidate();
    this.connectedBridge = bridge;
    this.frameCleanup = bridge.onAgentSessionFrame?.(frame => this.handleFrame(frame)) ?? null;
    this.failureCleanup = bridge.onAgentSessionFailure?.(message => {
      this.ended = true;
      this.clearRecoveryTimers();
      this.invalidate();
      this.patch({ phase: 'runtime-exited', replicaStatus: 'detached', displayRecovery: undefined, error: { code: 'unknown', detail: message } });
    }) ?? null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearRecoveryTimers();
    this.clearStabilityTimer();
    this.invalidate();
    this.frameCleanup?.();
    this.frameCleanup = null;
    this.failureCleanup?.();
    this.failureCleanup = null;
    this.connectedBridge = null;
  }

  private invalidate() {
    this.scope.cancel();
    this.scope = new ManagedOperationScope();
    ++this.epoch;
    const previous = this.subscription;
    this.subscription = null;
    this.clearWatermarkTimer();
    if (previous) this.detach(this.connectedBridge, previous.sessionId, previous.id, previous.instanceId);
  }

  private detach(bridge: AgentClientPort | null, sessionId: string, subscriptionId: string, instanceId?: string) {
    void bridge?.detachAgentSession?.({ rootPath: this.workspaceRoot, sessionId, subscriptionId, ...(instanceId ? { instanceId } : {}) }).catch(() => {});
  }

  async attachSession(sessionId: string): Promise<AgentSessionSnapshot | null> {
    if (this.disposed || this.paused) return null;
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
    const pending = Promise.resolve().then(() => {
      if (this.disposed || this.paused || epoch !== this.epoch) throw new Error('The display attach was cancelled before dispatch.');
      return attach({ rootPath: this.workspaceRoot, sessionId, ...(instanceId ? { instanceId } : {}) });
    });
    // An expired attach can still create a Main subscription; release its late receipt.
    void pending.then(receipt => {
      if (timedOut || this.disposed || epoch !== this.epoch) this.detach(bridge, sessionId, receipt.subscriptionId, instanceId);
    }, () => {});
    let receipt;
    try {
      receipt = await waitForScopedOperation(pending, this.scope.signal, ATTACH_TIMEOUT_MS);
    } catch (error) {
      timedOut = error instanceof ScopedOperationTimeoutError;
      if (this.disposed || epoch !== this.epoch) return null;
      if (this.handleEnded(error)) throw new AgentKnownError('session-ended');
      this.subscriptionFailed(epoch, timedOut ? 'attach-timeout' : 'attach-failed', error);
      throw new AgentKnownError('event-gap');
    }
    if (this.disposed || epoch !== this.epoch) return null;
    try {
      const snapshot = assertAgentSessionSnapshot(receipt.snapshot);
      if (snapshot.session.id !== sessionId || !snapshot.cursor || !snapshot.control) throw new Error('Invalid Agent display snapshot.');
      this.lastSnapshotItems = snapshot.display.parts.length;
      this.subscription = {
        id: receipt.subscriptionId,
        sessionId,
        instanceId: snapshot.session.instanceId,
        ...snapshot.cursor,
        acknowledgedRevision: null,
        ackPromise: null,
        epoch,
      };
      return snapshot;
    } catch (error) {
      this.detach(bridge, sessionId, receipt.subscriptionId, instanceId);
      this.subscriptionFailed(epoch, 'schema-invalid', error);
      throw new AgentKnownError('event-gap');
    }
  }

  async activateSessionFeed(sessionId: string) {
    const subscription = this.subscription;
    if (!subscription || subscription.sessionId !== sessionId) return false;
    try {
      const synchronized = await this.flushAcknowledgements(subscription);
      if (!synchronized && this.current(subscription)) {
        this.subscriptionFailed(subscription.epoch, 'backpressure-overflow');
        return false;
      }
      if (this.current(subscription)) this.patch({ replicaStatus: 'live' });
      return synchronized && this.current(subscription);
    } catch (error) {
      if (!this.current(subscription)) return false;
      if (this.handleEnded(error)) return false;
      this.subscriptionFailed(subscription.epoch, classifyRequestFailure('ack', error), error);
      return false;
    } finally {
      if (this.current(subscription) && this.readState().replicaStatus === 'live') this.scheduleWatermarkCheck();
    }
  }

  private subscriptionFailed(epoch: number, cause: AgentDisplayRecoveryCause, error?: unknown) {
    if (this.disposed || this.ended || epoch !== this.epoch) return;
    this.enterRecovery(cause, error);
    this.scheduleRecoveryRetry();
  }

  repairFrom(_afterSequence?: number, cause: AgentDisplayRecoveryCause = this.recoveryCause ?? 'revision-gap') {
    if (this.disposed || this.ended || this.paused) return Promise.resolve();
    if (this.repairPromise) return this.repairPromise;
    const sessionId = this.readState().session?.id;
    if (!sessionId) return Promise.resolve();
    this.enterRecovery(cause);
    if (this.attempts >= MAX_RECOVERY_ATTEMPTS) {
      this.pauseRecovery('exhausted');
      return Promise.resolve();
    }
    this.attempts++;
    this.patchRecovery();
    const repair = (async () => {
      let repairEpoch = this.epoch;
      try {
        const pending = this.attachSession(sessionId);
        repairEpoch = this.epoch;
        const snapshot = await pending;
        if (!snapshot || this.disposed || this.readState().session?.id !== sessionId) return;
        this.patch({ session: snapshot.session, control: snapshot.control!, projection: snapshot.display });
        const synchronized = await this.activateSessionFeed(sessionId);
        if (synchronized && !this.disposed && !this.paused && this.epoch === repairEpoch && this.readState().session?.id === sessionId) {
          this.finishRecovery();
        }
      } catch (error) {
        if (this.disposed || this.epoch !== repairEpoch) return;
        if (this.handleEnded(error)) return;
        if (error instanceof AgentKnownError && error.code === 'event-gap') return;
        this.enterRecovery(classifyRequestFailure('attach', error), error);
      }
    })().finally(() => {
      if (this.repairPromise !== repair) return;
      this.repairPromise = null;
      if (this.readState().replicaStatus !== 'stale') return;
      if (this.attempts >= MAX_RECOVERY_ATTEMPTS) {
        this.pauseRecovery('exhausted');
        return;
      }
      this.scheduleRecoveryRetry();
    });
    this.repairPromise = repair;
    return this.repairPromise;
  }

  pauseRecovery(policy: 'paused' | 'exhausted' = 'paused') {
    if (this.disposed) return;
    const cause = this.recoveryCause ?? 'revision-gap';
    this.paused = true;
    this.clearRecoveryTimers();
    this.clearStabilityTimer();
    this.invalidate();
    this.frameCleanup?.();
    this.frameCleanup = null;
    this.failureCleanup?.();
    this.failureCleanup = null;
    this.connectedBridge = null;
    this.repairPromise = null;
    this.patch({
      replicaStatus: 'stale',
      displayRecovery: { policy, stage: 'action-required', cause, attempt: this.attempts, maxAttempts: MAX_RECOVERY_ATTEMPTS },
    });
  }

  retryRecovery() {
    if (this.disposed || this.ended) return Promise.resolve();
    if (this.repairPromise) return this.repairPromise;
    const cause = this.recoveryCause ?? 'revision-gap';
    this.paused = false;
    this.attempts = 0;
    this.resetRecoveryIncident();
    this.connect();
    return this.repairFrom(undefined, cause);
  }

  private handleFrame(input: AgentSessionFrame) {
    const subscription = this.subscription;
    if (!subscription || !this.current(subscription) || input.subscriptionId !== subscription.id) return;
    try {
      const frame = assertAgentSessionFrame(input);
      this.scheduleWatermarkCheck();
      if (frame.type === 'resync-required') {
        void this.repairFrom(undefined, 'backpressure-overflow');
        return;
      }
      if (frame.streamId !== subscription.streamId) {
        void this.repairFrom(undefined, 'stream-reset');
        return;
      }
      if (frame.revision <= subscription.revision) return;
      if (frame.baseRevision !== subscription.revision || frame.session.id !== subscription.sessionId) {
        void this.repairFrom(undefined, 'revision-gap');
        return;
      }
      const projection = assertAgentDisplay(applyAgentDisplayPatch(this.readState().projection, frame.displayPatch));
      // Validate and publish the complete transaction before moving the cursor or ACKing it.
      this.patch({ projection, control: frame.control, session: frame.session });
      if (frame.control.connection.reason === 'session-closed') {
        this.endInstance();
        return;
      }
      subscription.revision = frame.revision;
      this.requestFrameAcknowledgement(subscription);
    } catch (error) {
      this.enterRecovery('schema-invalid', error);
      void this.repairFrom(undefined, 'schema-invalid');
    }
  }

  private current(subscription: Subscription) {
    return !this.disposed && !this.paused && this.subscription === subscription && subscription.epoch === this.epoch
      && this.readState().session?.id === subscription.sessionId;
  }

  private requestFrameAcknowledgement(subscription: Subscription) {
    // One in-flight loop always advances to the newest applied revision. A burst
    // therefore creates at most one outstanding IPC request instead of one per frame.
    if (subscription.ackPromise) return;
    void this.flushAcknowledgements(subscription).then(synchronized => {
      if (!synchronized && this.current(subscription)) this.subscriptionFailed(subscription.epoch, 'backpressure-overflow');
    }).catch(error => {
      if (!this.current(subscription) || this.handleEnded(error)) return;
      this.subscriptionFailed(subscription.epoch, classifyRequestFailure('ack', error), error);
    });
  }

  private flushAcknowledgements(subscription: Subscription): Promise<boolean> {
    if (subscription.ackPromise) return subscription.ackPromise;
    const bridge = this.connectedBridge;
    if (!bridge?.acknowledgeAgentSession) return Promise.reject(new Error('The Agent display feed cannot acknowledge changes.'));
    const operation = (async () => {
      while (this.current(subscription) && subscription.acknowledgedRevision !== subscription.revision) {
        const revision = subscription.revision;
        const result = await waitForScopedOperation(Promise.resolve().then(() => bridge.acknowledgeAgentSession!({
          rootPath: this.workspaceRoot,
          sessionId: subscription.sessionId,
          subscriptionId: subscription.id,
          ...(subscription.instanceId ? { instanceId: subscription.instanceId } : {}),
          streamId: subscription.streamId,
          revision,
        })), this.scope.signal, CONTROL_REQUEST_TIMEOUT_MS);
        if (!this.current(subscription) || !result.synchronized) return false;
        subscription.acknowledgedRevision = revision;
      }
      return this.current(subscription);
    })();
    const tracked = operation.finally(() => {
      if (subscription.ackPromise === tracked) subscription.ackPromise = null;
    });
    subscription.ackPromise = tracked;
    return tracked;
  }

  private scheduleWatermarkCheck() {
    this.clearWatermarkTimer();
    if (this.disposed || this.ended || this.paused || !this.subscription || this.readState().replicaStatus !== 'live') return;
    this.watermarkTimer = setTimeout(() => {
      this.watermarkTimer = null;
      void this.checkWatermark();
    }, WATERMARK_IDLE_MS);
  }

  private clearWatermarkTimer() {
    if (this.watermarkTimer) clearTimeout(this.watermarkTimer);
    this.watermarkTimer = null;
  }

  private async checkWatermark() {
    const subscription = this.subscription;
    const bridge = this.connectedBridge;
    if (!subscription || !this.current(subscription) || !bridge?.readAgentSessionWatermark) return;
    try {
      const watermark = await waitForScopedOperation(Promise.resolve().then(() => bridge.readAgentSessionWatermark!({
        rootPath: this.workspaceRoot,
        sessionId: subscription.sessionId,
        subscriptionId: subscription.id,
        ...(subscription.instanceId ? { instanceId: subscription.instanceId } : {}),
      })), this.scope.signal, CONTROL_REQUEST_TIMEOUT_MS);
      if (!this.current(subscription)) return;
      // Frames may advance while this read is in flight. A lower watermark is harmless.
      if (watermark.resyncRequired) await this.repairFrom(undefined, 'backpressure-overflow');
      else if (watermark.streamId !== subscription.streamId) await this.repairFrom(undefined, 'stream-reset');
      else if (watermark.revision > subscription.revision) await this.repairFrom(undefined, 'revision-gap');
    } catch (error) {
      if (!this.current(subscription) || this.handleEnded(error)) return;
      await this.repairFrom(undefined, classifyRequestFailure('watermark', error));
    } finally {
      if (this.readState().replicaStatus === 'live') this.scheduleWatermarkCheck();
    }
  }

  private enterRecovery(cause: AgentDisplayRecoveryCause, error?: unknown) {
    if (this.disposed || this.ended || this.paused) return;
    this.clearWatermarkTimer();
    this.clearStabilityTimer();
    const newIncident = this.recoveryStartedAt === null;
    if (newIncident) {
      this.recoveryStartedAt = Date.now();
      this.scheduleRecoveryVisibility();
    }
    const previousCause = this.recoveryCause;
    this.recoveryCause = cause;
    const recovery = this.readState().displayRecovery;
    const stage = recovery?.policy === 'automatic' ? recovery.stage : 'silent';
    this.patch({
      replicaStatus: 'stale',
      displayRecovery: { policy: 'automatic', stage, cause, attempt: this.attempts, maxAttempts: MAX_RECOVERY_ATTEMPTS },
    });
    if (newIncident || previousCause !== cause) this.logRecovery(cause, error);
  }

  private patchRecovery(stage?: AgentDisplayRecoveryStage) {
    const recovery = this.readState().displayRecovery;
    this.patch({
      replicaStatus: 'stale',
      displayRecovery: {
        policy: 'automatic',
        stage: stage ?? (recovery?.policy === 'automatic' ? recovery.stage : 'silent'),
        cause: this.recoveryCause ?? 'revision-gap',
        attempt: this.attempts,
        maxAttempts: MAX_RECOVERY_ATTEMPTS,
      },
    });
  }

  private scheduleRecoveryVisibility() {
    this.clearVisibilityTimers();
    const startedAt = this.recoveryStartedAt;
    this.reconnectingTimer = setTimeout(() => {
      this.reconnectingTimer = null;
      if (this.recoveryStartedAt === startedAt && this.readState().displayRecovery?.policy === 'automatic') {
        this.patchRecovery('reconnecting');
      }
    }, RECOVERY_RECONNECTING_DELAY_MS);
    this.degradedTimer = setTimeout(() => {
      this.degradedTimer = null;
      if (this.recoveryStartedAt === startedAt && this.readState().displayRecovery?.policy === 'automatic') {
        this.patchRecovery('degraded');
      }
    }, RECOVERY_DEGRADED_DELAY_MS);
  }

  private scheduleRecoveryRetry() {
    if (this.disposed || this.ended || this.paused || this.repairPromise || this.recoveryRetryTimer || !this.readState().session) return;
    if (this.attempts >= MAX_RECOVERY_ATTEMPTS) {
      this.pauseRecovery('exhausted');
      return;
    }
    const delay = Math.min(RECOVERY_RETRY_MAX_MS, RECOVERY_RETRY_BASE_MS * 2 ** this.attempts);
    this.recoveryRetryTimer = setTimeout(() => {
      this.recoveryRetryTimer = null;
      void this.repairFrom(undefined, this.recoveryCause ?? 'revision-gap');
    }, delay);
  }

  private finishRecovery() {
    this.clearRecoveryTimers();
    this.recoveryStartedAt = null;
    this.recoveryCause = null;
    this.patch({
      replicaStatus: 'live',
      displayRecovery: undefined,
      ...(this.readState().error?.code === 'event-gap' ? { error: null } : {}),
    });
    this.clearStabilityTimer();
    this.stabilityTimer = setTimeout(() => {
      this.stabilityTimer = null;
      if (this.readState().replicaStatus === 'live') this.attempts = 0;
    }, RECOVERY_STABILITY_WINDOW_MS);
    this.scheduleWatermarkCheck();
  }

  private resetRecoveryIncident() {
    this.clearRecoveryTimers();
    this.clearStabilityTimer();
    this.recoveryStartedAt = null;
    this.recoveryCause = null;
  }

  private clearVisibilityTimers() {
    if (this.reconnectingTimer) clearTimeout(this.reconnectingTimer);
    if (this.degradedTimer) clearTimeout(this.degradedTimer);
    this.reconnectingTimer = null;
    this.degradedTimer = null;
  }

  private clearRecoveryTimers() {
    this.clearVisibilityTimers();
    if (this.recoveryRetryTimer) clearTimeout(this.recoveryRetryTimer);
    this.recoveryRetryTimer = null;
  }

  private clearStabilityTimer() {
    if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
    this.stabilityTimer = null;
  }

  private logRecovery(cause: AgentDisplayRecoveryCause, error?: unknown) {
    const state = this.readState();
    const subscription = this.subscription;
    console.warn('Agent display feed entered recovery', {
      cause,
      attempt: this.attempts,
      expectedRevision: subscription?.revision ?? null,
      acknowledgedRevision: subscription?.acknowledgedRevision ?? null,
      streamId: subscription?.streamId ?? null,
      snapshotItems: this.lastSnapshotItems,
      elapsedMs: this.recoveryStartedAt === null ? 0 : Math.max(0, Date.now() - this.recoveryStartedAt),
      runtimeId: state.session?.runtimeId ?? state.selectedRuntimeId,
      runtimeVersion: state.inspection?.readiness?.version ?? null,
      timeoutMs: error instanceof ScopedOperationTimeoutError ? error.timeoutMs : null,
    });
  }

  private handleEnded(error: unknown) {
    const code = error instanceof AgentOperationError ? error.failure.code : error instanceof AgentKnownError ? error.code : null;
    if (!code || !['SESSION_NOT_FOUND', 'SESSION_STALE', 'PROJECT_STALE', 'PROJECT_CLOSING', 'session-ended'].includes(code)) return false;
    this.endInstance();
    return true;
  }

  private endInstance() {
    this.ended = true;
    this.clearRecoveryTimers();
    this.clearStabilityTimer();
    this.invalidate();
    this.patch({ phase: 'runtime-exited', replicaStatus: 'detached', displayRecovery: undefined, error: { code: 'session-ended' } });
  }
}

function classifyRequestFailure(operation: 'attach' | 'ack' | 'watermark', error: unknown): AgentDisplayRecoveryCause {
  const timedOut = error instanceof ScopedOperationTimeoutError;
  if (operation === 'attach') return timedOut ? 'attach-timeout' : 'attach-failed';
  if (operation === 'ack') return timedOut ? 'ack-timeout' : 'ack-failed';
  return timedOut ? 'watermark-timeout' : 'watermark-failed';
}

export const agentSessionReplicaLimits = Object.freeze({
  watermarkIdleMs: WATERMARK_IDLE_MS,
  attachTimeoutMs: ATTACH_TIMEOUT_MS,
  controlRequestTimeoutMs: CONTROL_REQUEST_TIMEOUT_MS,
  recoveryReconnectingDelayMs: RECOVERY_RECONNECTING_DELAY_MS,
  recoveryDegradedDelayMs: RECOVERY_DEGRADED_DELAY_MS,
  recoveryStabilityWindowMs: RECOVERY_STABILITY_WINDOW_MS,
  recoveryRetryBaseMs: RECOVERY_RETRY_BASE_MS,
  maxRecoveryAttempts: MAX_RECOVERY_ATTEMPTS,
});
