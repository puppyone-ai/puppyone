import { applyAgentEvent, applyAgentEvents, createAgentProjection } from "../domain/agent-projection";
import type { AgentEvent, AgentSessionControl, AgentSessionFrame, AgentSessionMetadata, AgentSessionSnapshot } from "../domain/agent-contract";
import type { AgentControllerState } from "./agent-controller-state";
import { phaseForProjection } from "./agent-controller-state";
import { createAgentError, formatAgentError } from "./agent-error";
import type { AgentClientPort, AgentClientProvider } from "./AgentClientPort";

type StatePatch = (patch: Partial<AgentControllerState>) => void;

const STREAM_FRAME_MS = 16;
const MAX_BUFFERED_EVENTS = 2_000;
const WATERMARK_INTERVAL_MS = 5_000;

export type AgentStreamFlushScheduler = (callback: () => void) => () => void;

export class AgentEventSynchronizer {
  private eventCleanup: (() => void) | null = null;
  private exitCleanup: (() => void) | null = null;
  private frameCleanup: (() => void) | null = null;
  private connectedBridge: AgentClientPort | null = null;
  private bufferedEvents: AgentEvent[] = [];
  private bufferedSequences = new Set<number>();
  private readonly preSessionEvents = new Map<string, AgentEvent[]>();
  private cancelScheduledFlush: (() => void) | null = null;
  private replayPromise: Promise<void> | null = null;
  private subscriptionId: string | null = null;
  private feedStreamId: string | null = null;
  private feedRevision = 0;
  private attachEpoch = 0;
  private watermarkTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly bridgeProvider: AgentClientProvider,
    private readonly readState: () => AgentControllerState,
    private readonly patch: StatePatch,
    private readonly onTurnReady: () => void,
    private readonly scheduleFlush: AgentStreamFlushScheduler = scheduleStreamTimer,
  ) {}

  connect() {
    if (this.disposed) return;
    const bridge = this.bridgeProvider();
    if (!bridge || bridge === this.connectedBridge) return;
    this.eventCleanup?.();
    this.exitCleanup?.();
    this.frameCleanup?.();
    this.connectedBridge = bridge;
    const feedAvailable = Boolean(bridge.attachAgentSession && bridge.acknowledgeAgentSession && bridge.onAgentSessionFrame);
    this.eventCleanup = feedAvailable ? null : bridge.onAgentEvent?.((event) => this.enqueue(event)) ?? null;
    this.frameCleanup = feedAvailable ? bridge.onAgentSessionFrame?.((frame) => this.handleFrame(frame)) ?? null : null;
    this.exitCleanup = feedAvailable ? null : bridge.onAgentSessionExit?.((event) => this.handleSessionExit(event)) ?? null;
  }

  dispose() {
    if (this.disposed) return;
    const bridge = this.connectedBridge;
    const sessionId = this.readState().session?.id;
    this.disposed = true;
    this.eventCleanup?.();
    this.exitCleanup?.();
    this.frameCleanup?.();
    this.eventCleanup = null;
    this.exitCleanup = null;
    this.frameCleanup = null;
    this.connectedBridge = null;
    this.cancelScheduledFlush?.();
    this.cancelScheduledFlush = null;
    this.bufferedEvents = [];
    this.bufferedSequences.clear();
    this.preSessionEvents.clear();
    if (this.watermarkTimer) clearTimeout(this.watermarkTimer);
    this.watermarkTimer = null;
    if (bridge?.detachAgentSession && sessionId && this.subscriptionId) {
      void bridge.detachAgentSession({ rootPath: this.workspaceRoot, sessionId, subscriptionId: this.subscriptionId }).catch(() => {});
    }
    this.subscriptionId = null;
    this.feedStreamId = null;
  }

  async attachSession(sessionId: string): Promise<AgentSessionSnapshot | null> {
    const bridge = this.bridgeProvider();
    if (!bridge?.attachAgentSession || !bridge.acknowledgeAgentSession || !bridge.onAgentSessionFrame) return null;
    const epoch = ++this.attachEpoch;
    const previousSubscriptionId = this.subscriptionId;
    const previousSessionId = this.readState().session?.id;
    if (previousSubscriptionId && previousSessionId && bridge.detachAgentSession) {
      await bridge.detachAgentSession({
        rootPath: this.workspaceRoot,
        sessionId: previousSessionId,
        subscriptionId: previousSubscriptionId,
      }).catch(() => {});
    }
    const receipt = await bridge.attachAgentSession({ rootPath: this.workspaceRoot, sessionId });
    if (this.disposed || epoch !== this.attachEpoch) {
      await bridge.detachAgentSession?.({ rootPath: this.workspaceRoot, sessionId, subscriptionId: receipt.subscriptionId }).catch(() => {});
      return null;
    }
    const cursor = receipt.snapshot.cursor;
    if (!cursor) throw new Error("Main returned an Agent feed snapshot without a cursor.");
    this.subscriptionId = receipt.subscriptionId;
    this.feedStreamId = cursor.streamId;
    this.feedRevision = cursor.revision;
    return receipt.snapshot;
  }

  async activateSessionFeed(sessionId: string) {
    const bridge = this.bridgeProvider();
    if (!bridge?.acknowledgeAgentSession || !this.subscriptionId || !this.feedStreamId) return;
    await bridge.acknowledgeAgentSession({
      rootPath: this.workspaceRoot,
      sessionId,
      subscriptionId: this.subscriptionId,
      streamId: this.feedStreamId,
      revision: this.feedRevision,
    });
    this.scheduleWatermarkCheck();
  }

  flush() {
    if (this.disposed) return;
    this.cancelScheduledFlush?.();
    this.cancelScheduledFlush = null;
    if (this.bufferedEvents.length === 0) return;
    const state = this.readState();
    const ordered = this.bufferedEvents.sort((left, right) => left.sequence - right.sequence);
    this.bufferedEvents = [];
    this.bufferedSequences.clear();
    let cursor = state.projection.lastSequence;
    const applicable: AgentEvent[] = [];
    const deferred: AgentEvent[] = [];
    for (const event of ordered) {
      if (event.sequence <= cursor) continue;
      if (event.sequence > cursor + 1) {
        deferred.push(event);
        continue;
      }
      applicable.push(event);
      cursor = event.sequence;
    }
    const projection = applyAgentEvents(state.projection, applicable);
    const providerFailure = rejectedProviderPatch(state, projection, applicable);
    const turnAccepted = applicable.some((event) => event.type === "turn.started");
    const turnEnded = applicable.some(isTurnTerminalEvent);
    this.bufferedEvents.push(...deferred);
    for (const event of deferred) this.bufferedSequences.add(event.sequence);
    this.patch({
      projection,
      phase: phaseForProjection(projection, state.phase),
      stopping: projection.runningTurnId ? state.stopping : false,
      pendingPrompt: turnAccepted || turnEnded ? null : state.pendingPrompt,
      pendingIntent: turnAccepted || turnEnded ? null : state.pendingIntent,
      session: state.session
        ? applicable.reduce(updateSessionFromProjectionEvent, state.session)
        : null,
      ...providerFailure,
    });
    if (!projection.runningTurnId) this.onTurnReady();
    if (deferred.length > 0) void this.replayFrom(projection.lastSequence);
  }

  /**
   * Claims events that arrived after the native session was selected but before
   * its snapshot reached the renderer. The snapshot and these events are folded
   * in one synchronous step by the controller, closing the restore race.
   */
  takePreSessionEvents(sessionId: string, afterSequence: number) {
    const events = this.preSessionEvents.get(sessionId) ?? [];
    this.preSessionEvents.delete(sessionId);
    return events
      .filter((event) => event.sequence > afterSequence)
      .sort((left, right) => left.sequence - right.sequence);
  }

  repairFrom(afterSequence: number) {
    if (this.disposed) return Promise.resolve();
    if (this.subscriptionId) return this.resubscribeFromFeed();
    return this.replayFrom(afterSequence);
  }

  private enqueue(event: AgentEvent) {
    if (this.disposed) return;
    const state = this.readState();
    if (event.sessionId !== state.session?.id) {
      if (!state.session) this.bufferBeforeSessionBinding(event);
      return;
    }
    if (event.sequence <= state.projection.lastSequence) return;
    if (!this.bufferedSequences.has(event.sequence)) {
      this.bufferedEvents.push(event);
      this.bufferedSequences.add(event.sequence);
    }
    if (this.bufferedEvents.length > MAX_BUFFERED_EVENTS) {
      const removed = this.bufferedEvents.splice(0, this.bufferedEvents.length - MAX_BUFFERED_EVENTS);
      for (const entry of removed) this.bufferedSequences.delete(entry.sequence);
    }
    if (isUrgentEvent(event) || event.sequence > state.projection.lastSequence + 1) {
      this.flush();
      return;
    }
    if (!this.cancelScheduledFlush) {
      this.cancelScheduledFlush = this.scheduleFlush(() => {
        this.cancelScheduledFlush = null;
        this.flush();
      });
    }
  }

  private handleSessionExit(event: { sessionId: string; reason: string }) {
    if (this.disposed) return;
    const state = this.readState();
    if (event.sessionId !== state.session?.id || event.reason !== "provider-exited") return;
    this.flush();
    const latest = this.readState();
    if (!latest.session) return;
    const projection = {
      ...latest.projection,
      approvals: [],
      questions: [],
      runningTurnId: null,
      terminalState: latest.projection.runningTurnId ? "failed" as const : latest.projection.terminalState,
    };
    const runtimeName = latest.session.runtime?.displayName
      || latest.inspection?.runtime?.displayName
      || latest.inspection?.runtimes?.find((entry) => entry.descriptor.id === latest.selectedRuntimeId)?.descriptor.displayName
      || humanizeRuntimeId(latest.selectedRuntimeId || latest.session.runtimeId || latest.session.provider)
      || "";
    this.patch({
      session: { ...latest.session, activeTurnId: null, terminalState: "provider-exited" },
      projection,
      phase: "runtime-exited",
      stopping: false,
      submitting: false,
      resolvingBlocker: false,
      pendingPrompt: null,
      pendingIntent: null,
      sessionPreparation: "failed",
      error: createAgentError("runtime-exited", runtimeName ? { runtime: runtimeName } : undefined),
    });
  }

  private replayFrom(afterSequence: number) {
    if (this.disposed) return Promise.resolve();
    if (this.replayPromise) return this.replayPromise;
    const sessionId = this.readState().session?.id;
    const bridge = this.bridgeProvider();
    if (!sessionId || !bridge?.replayAgentSession) return Promise.resolve();
    this.replayPromise = (async () => {
      try {
        let cursor = afterSequence;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const snapshot = await bridge.replayAgentSession({ rootPath: this.workspaceRoot, sessionId, afterSequence: cursor });
          if (this.disposed) return;
          const state = this.readState();
          if (state.session?.id !== sessionId) return;
          let projection = applyAgentEvents(state.projection, snapshot.events, { partialHistory: snapshot.partial });
          const buffered = this.bufferedEvents.sort((left, right) => left.sequence - right.sequence);
          const appliedBuffered: AgentEvent[] = [];
          this.bufferedEvents = [];
          this.bufferedSequences.clear();
          for (const event of buffered) {
            if (event.sequence <= projection.lastSequence + 1) {
              projection = applyAgentEvent(projection, event);
              appliedBuffered.push(event);
            }
            else {
              this.bufferedEvents.push(event);
              this.bufferedSequences.add(event.sequence);
            }
          }
          const lifecycleEvents = [...snapshot.events, ...appliedBuffered];
          const turnAccepted = lifecycleEvents.some((event) => event.type === "turn.started");
          const turnEnded = lifecycleEvents.some(isTurnTerminalEvent);
          this.patch({
            projection,
            phase: phaseForProjection(projection, state.phase),
            stopping: projection.runningTurnId ? state.stopping : false,
            pendingPrompt: turnAccepted || turnEnded ? null : state.pendingPrompt,
            pendingIntent: turnAccepted || turnEnded ? null : state.pendingIntent,
            session: {
              ...snapshot.session,
              activeTurnId: projection.runningTurnId,
              terminalState: projection.runningTurnId ? "running" : projection.terminalState || snapshot.session.terminalState,
              lastSequence: projection.lastSequence,
            },
            ...rejectedProviderPatch(state, projection, lifecycleEvents),
          });
          if (!projection.runningTurnId) this.onTurnReady();
          cursor = projection.lastSequence;
          if (this.bufferedEvents.length === 0) return;
        }
        this.patch({ error: createAgentError("event-gap") });
      } catch (error) {
        if (!this.disposed) this.patch({ error: formatAgentError(error) });
      }
    })().finally(() => { this.replayPromise = null; });
    return this.replayPromise;
  }

  private bufferBeforeSessionBinding(event: AgentEvent) {
    const existing = this.preSessionEvents.get(event.sessionId) ?? [];
    if (existing.some((candidate) => candidate.sequence === event.sequence)) return;
    existing.push(event);
    existing.sort((left, right) => left.sequence - right.sequence);
    if (existing.length > MAX_BUFFERED_EVENTS) existing.splice(0, existing.length - MAX_BUFFERED_EVENTS);
    this.preSessionEvents.clear();
    this.preSessionEvents.set(event.sessionId, existing);
  }

  private handleFrame(frame: AgentSessionFrame) {
    if (this.disposed || frame.subscriptionId !== this.subscriptionId) return;
    if (frame.type === "resync-required") {
      void this.resubscribeFromFeed();
      return;
    }
    if (frame.streamId !== this.feedStreamId) {
      void this.resubscribeFromFeed();
      return;
    }
    if (frame.revision <= this.feedRevision) return;
    if (frame.baseRevision !== this.feedRevision) {
      void this.resubscribeFromFeed();
      return;
    }
    this.feedRevision = frame.revision;
    for (const event of frame.events) this.enqueue(event);
    // Acknowledgement means the semantic frame is in the replica, not merely
    // sitting in an animation buffer.
    this.flush();
    this.applyControl(frame.control);
    const sessionId = this.readState().session?.id;
    const bridge = this.bridgeProvider();
    if (sessionId && bridge?.acknowledgeAgentSession && this.subscriptionId && this.feedStreamId) {
      void bridge.acknowledgeAgentSession({
        rootPath: this.workspaceRoot,
        sessionId,
        subscriptionId: this.subscriptionId,
        streamId: this.feedStreamId,
        revision: this.feedRevision,
      }).catch(() => { void this.resubscribeFromFeed(); });
    }
    this.scheduleWatermarkCheck();
  }

  private applyControl(control: AgentSessionControl) {
    const state = this.readState();
    if (!state.session || control.streamId !== this.feedStreamId) return;
    const activeTurnId = control.execution.activeTurnId;
    const projection = {
      ...state.projection,
      runningTurnId: activeTurnId,
      terminalState: activeTurnId ? null : control.execution.nativeOutcome ?? state.projection.terminalState,
      connectionStatus: control.connection.status === "recovering"
        ? {
            state: "reconnecting" as const,
            message: control.connection.reason ?? "",
            attempt: null,
            maxAttempts: null,
            turnId: activeTurnId,
            sequence: state.projection.lastSequence,
          }
        : state.projection.connectionStatus,
    };
    this.patch({
      control,
      projection,
      session: {
        ...state.session,
        activeTurnId,
        terminalState: control.connection.status === "exited"
          ? "provider-exited"
          : activeTurnId ? "running"
            : control.execution.status === "outcome-unknown" ? "outcome-unknown"
              : control.execution.nativeOutcome ?? "idle",
      },
    });
  }

  private async resubscribeFromFeed() {
    const sessionId = this.readState().session?.id;
    if (!sessionId || this.replayPromise) return;
    this.replayPromise = (async () => {
      try {
        const snapshot = await this.attachSession(sessionId);
        if (!snapshot || this.disposed || this.readState().session?.id !== sessionId) return;
        // Reuse the controller's snapshot state boundary via the legacy replay
        // callback contract: apply the complete timeline and authoritative
        // control before releasing buffered frames.
        const projection = applyAgentEvents(
          createProjectionForFeed(snapshot),
          [...(snapshot.timeline?.checkpointEvents ?? []), ...snapshot.events]
            .filter((event, index, events) => events.findIndex((candidate) => candidate.sequence === event.sequence) === index),
          { partialHistory: snapshot.partial },
        );
        this.patch({
          control: snapshot.control ?? null,
          projection: snapshot.control ? {
            ...projection,
            runningTurnId: snapshot.control.execution.activeTurnId,
            terminalState: snapshot.control.execution.activeTurnId ? null : snapshot.control.execution.nativeOutcome,
          } : projection,
          session: snapshot.session,
        });
        await this.activateSessionFeed(sessionId);
        this.patch({ replicaStatus: "live" });
      } catch (error) {
        if (!this.disposed) this.patch({ error: formatAgentError(error) });
      }
    })().finally(() => { this.replayPromise = null; });
    return this.replayPromise;
  }

  private scheduleWatermarkCheck() {
    if (this.disposed || this.watermarkTimer || !this.subscriptionId) return;
    const bridge = this.bridgeProvider();
    if (!bridge?.readAgentSessionWatermark) return;
    this.watermarkTimer = setTimeout(() => {
      this.watermarkTimer = null;
      void this.checkWatermark();
    }, WATERMARK_INTERVAL_MS);
  }

  private async checkWatermark() {
    const state = this.readState();
    const bridge = this.bridgeProvider();
    if (this.disposed || !state.session || !bridge?.readAgentSessionWatermark || !this.subscriptionId) return;
    try {
      const watermark = await bridge.readAgentSessionWatermark({
        rootPath: this.workspaceRoot,
        sessionId: state.session.id,
        subscriptionId: this.subscriptionId,
      });
      if (watermark.resyncRequired || watermark.streamId !== this.feedStreamId || watermark.revision !== this.feedRevision) {
        this.patch({ replicaStatus: "stale" });
        await this.resubscribeFromFeed();
      }
    } catch {
      this.patch({ replicaStatus: "stale" });
    } finally {
      this.scheduleWatermarkCheck();
    }
  }
}

function createProjectionForFeed(snapshot: AgentSessionSnapshot) {
  return createAgentProjection({ partialHistory: snapshot.partial });
}

function updateSessionFromProjectionEvent(session: AgentSessionMetadata, event?: AgentEvent) {
  if (!event) return session;
  const terminal = event.type === "turn.completed" ? "completed"
    : event.type === "turn.failed" ? "failed"
      : event.type === "turn.interrupted" ? "interrupted"
        : null;
  return {
    ...session,
    title: event.type === "session.updated" && typeof event.payload.title === "string" ? event.payload.title : session.title,
    lastSequence: Math.max(session.lastSequence, event.sequence),
    updatedAt: event.emittedAt,
    activeTurnId: event.type === "turn.started" ? event.turnId : terminal ? null : session.activeTurnId,
    terminalState: event.type === "turn.started" ? "running" : terminal || session.terminalState,
  };
}

function isUrgentEvent(event: AgentEvent) {
  return event.type === "turn.started"
    || event.type.startsWith("approval.")
    || event.type.startsWith("question.")
    || event.type === "turn.completed"
    || event.type === "turn.failed"
    || event.type === "turn.interrupted"
    || event.type === "provider.error";
}

function isTurnTerminalEvent(event: AgentEvent) {
  return event.type === "turn.completed" || event.type === "turn.failed" || event.type === "turn.interrupted";
}

function humanizeRuntimeId(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function rejectedProviderPatch(state: AgentControllerState, projection: AgentControllerState["projection"], events: AgentEvent[]) {
  if (!events.some((event) => event.type === "provider.error") || !state.selectedProviderId || !state.inspection) return {};
  const message = [...projection.activities].reverse().find((activity) => activity.kind === "error")?.label ?? "";
  if (!/(?:api\s*key|credential|authentication|unauthori[sz]ed|forbidden|status\s*401|http\s*401).*(?:invalid|reject|fail|expired|missing)|(?:invalid|reject|fail|expired|missing).*(?:api\s*key|credential|authentication)|api\s*key\s*not\s*valid/i.test(message)) return {};
  const providerId = state.selectedProviderId;
  const providers = (state.inspection.providers ?? []).filter((provider) => provider.id !== providerId);
  const models = state.inspection.models.filter((model) => (model.providerId || modelProviderId(model.model)) !== providerId);
  const providerName = state.inspection.providers?.find((provider) => provider.id === providerId)?.displayName || providerId;
  const hasAlternative = providers.length > 0 && models.length > 0;
  return {
    selectedProviderId: null,
    selectedModel: null,
    selectedEffort: null,
    inspection: {
      ...state.inspection,
      providers,
      models,
      readiness: hasAlternative || !state.inspection.readiness
        ? state.inspection.readiness
        : {
          ...state.inspection.readiness,
          status: "installed-not-authenticated" as const,
          code: "PROVIDER_CREDENTIALS_REJECTED" as const,
          message: "",
        },
    },
    error: hasAlternative
      ? createAgentError("provider-credentials-rejected", { provider: providerName })
      : null,
  } satisfies Partial<AgentControllerState>;
}

function modelProviderId(model: string) {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : null;
}

export const agentEventSynchronizationLimits = Object.freeze({
  streamBatchMs: STREAM_FRAME_MS,
  maxBufferedEvents: MAX_BUFFERED_EVENTS,
  watermarkIntervalMs: WATERMARK_INTERVAL_MS,
});

function scheduleStreamTimer(callback: () => void) {
  const timer = setTimeout(callback, STREAM_FRAME_MS);
  return () => clearTimeout(timer);
}
