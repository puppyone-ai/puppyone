import { randomUUID } from "node:crypto";
import { redactSecretText } from "../../agent-events.mjs";
import {
  normalizeApprovalDecision,
  normalizeOptionalString,
  normalizeQuestionAnswers,
  normalizeRequiredId,
  normalizeSequence,
  requireMatchingWorkspace,
} from "../agent-input-policy.mjs";
import {
  abandonAgentTurnReferences,
  beginAgentTurnReferences,
  prepareAgentTurnReferenceInput,
  prepareAgentSteerReferenceInput,
  privateReferenceLeaseTokens,
  withAgentSteerReferenceTokens,
} from "../agent-reference-policy.mjs";
import { sessionMetadata } from "../../domain/agent-session-model.mjs";

const MAX_QUEUED_TURNS = 20;

/** Owns user-driven turn and blocking-interaction commands for live sessions. */
export function createAgentTurnCoordinator({
  runtimeSession,
  emit,
  persistSoon,
  attachmentStore = null,
}) {
  const queuedStarts = new Map();
  const observedSessions = new Map();
  const drainingSessions = new Set();

  async function startTurn(sender, request, workspaceRoot = null) {
    const session = runtimeSession.requireOwnedSession(sender, request?.sessionId);
    requireMatchingWorkspace(session, workspaceRoot);
    requireCommandPreconditions(session, request);
    const commandId = commandIdentity(request?.commandId);
    const repeated = repeatedCommand(session, request?.commandId, "start");
    if (repeated) return commandReceipt(session, repeated);
    runtimeSession.requireConnectedSession(session);
    const model = normalizeOptionalString(request?.model) || session.selectedModel;
    const effort = normalizeOptionalString(request?.effort) || session.selectedEffort;
    const mode = normalizeOptionalString(request?.mode) || session.selectedMode;
    runtimeSession.requireAvailableModel(session, model);
    runtimeSession.requireAvailableEffort(session, model, effort);
    if (session.activeTurnId || session.turnStarting || session.interruptingTurnId) {
      if (!session.capabilities?.queue) throw new Error("An Agent turn is already running or stopping.");
      if (session.actor.control.queue.length >= MAX_QUEUED_TURNS) {
        throw new Error(`Agent prompt queue is full (${MAX_QUEUED_TURNS}).`);
      }
      const deliveryForReference = typeof session.adapter?.referenceMentionDelivery === "function"
        ? (reference) => session.adapter.referenceMentionDelivery(reference)
        : undefined;
      // Validate and authorize the immutable input before accepting it into the
      // Main-owned queue; hydration never calls this effectful path.
      prepareAgentTurnReferenceInput(request, session.capabilities, deliveryForReference);
      session.actor.dispatch({
        type: "command.received",
        command: { commandId, kind: "start", status: "queued", targetTurnId: null },
      });
      queuedStarts.set(commandId, { session, request: { ...request }, model, effort, mode, commandId, queued: true });
      observeQueue(session);
      return { sessionId: session.id, commandId, queued: true, turnId: session.activeTurnId };
    }
    session.actor.dispatch({
      type: "command.received",
      command: { commandId, kind: "start", status: "dispatching", targetTurnId: null },
    });
    return executeStart({ session, request, model, effort, mode, commandId, queued: false });
  }

  async function executeStart({ session, request, model, effort, mode, commandId, queued }) {
    const operationGeneration = session.actor.control.adapterGeneration;
    const operationId = operationIdentity(commandId);
    session.actor.dispatch({ type: "command.dispatching", commandId, operationId });
    try {
      const { references, referenceDisplays, prompt, displayPrompt, promptMentions } = beginAgentTurnReferences(session, request);
      session.selectedModel = model;
      session.selectedEffort = effort;
      session.selectedMode = mode;
      const result = await session.adapter.startTurn({
        prompt,
        model,
        ...(effort ? { effort } : {}),
        mode,
        references,
        attachments: references.filter((entry) => entry.kind === "staged-attachment"),
        contextReferences: references.filter((entry) => entry.kind === "workspace-entry"),
      });
      if (!runtimeSession.isCurrent(session)
        || session.actor.control.adapterGeneration !== operationGeneration
        || ["exited", "disconnected"].includes(session.actor.control.connection.status)) {
        session.actor.dispatch({ type: "command.outcome-unknown", commandId, operationId, error: "session-generation-changed" });
        throw new Error("The Agent session changed before turn acceptance could be confirmed.");
      }
      const alreadyTerminal = session.terminalTurnIds.has(result.turnId);
      if (!alreadyTerminal && session.lastStartedTurnId !== result.turnId) {
        emit(session, {
          type: "turn.started",
          providerSessionId: session.providerSessionId,
          turnId: result.turnId,
          payload: { status: "running", prompt: displayPrompt, model, effort, mode, referenceDisplays, promptMentions },
        });
      }
      session.actor.dispatch({ type: "command.accepted", commandId, operationId, turnId: result.turnId });
      persistSoon(session);
      return { sessionId: session.id, commandId, queued: false, turnId: result.turnId };
    } catch (error) {
      abandonAgentTurnReferences(session);
      session.actor.dispatch({
        type: "command.rejected",
        commandId,
        operationId,
        error: redactSecretText(error instanceof Error ? error.message : String(error)),
      });
      if (queued) await releaseQueuedLease(session, request);
      throw new Error(redactSecretText(error instanceof Error ? error.message : String(error)));
    } finally {
      scheduleQueueDrain(session);
    }
  }

  async function steerTurn(sender, request, workspaceRoot = null) {
    const session = runtimeSession.requireOwnedSession(sender, request?.sessionId);
    requireMatchingWorkspace(session, workspaceRoot);
    requireCommandPreconditions(session, request);
    const commandId = commandIdentity(request?.commandId);
    const repeated = repeatedCommand(session, request?.commandId, "steer");
    if (repeated) return { ...commandReceipt(session, repeated), steered: true };
    runtimeSession.requireConnectedSession(session);
    const turnId = normalizeRequiredId(request?.turnId, "Turn id");
    if (session.activeTurnId !== turnId) throw new Error("That Agent turn is no longer running.");
    if (!session.capabilities?.steer || typeof session.adapter.steerTurn !== "function") {
      throw new Error("The active Agent runtime does not support steering a running turn.");
    }
    const deliveryForReference = typeof session.adapter?.referenceMentionDelivery === "function"
      ? (reference) => session.adapter.referenceMentionDelivery(reference)
      : undefined;
    const { message, references } = prepareAgentSteerReferenceInput(request, session.capabilities, deliveryForReference);
    session.actor.dispatch({ type: "command.received", command: { commandId, kind: "steer", status: "dispatching", targetTurnId: turnId } });
    const operationId = operationIdentity(commandId);
    session.actor.dispatch({ type: "command.dispatching", commandId, operationId });
    try {
      await withAgentSteerReferenceTokens(session, request, () => session.adapter.steerTurn({ turnId, message, references }));
      session.actor.dispatch({ type: "command.accepted", commandId, operationId, turnId });
      return { sessionId: session.id, commandId, turnId, steered: true };
    } catch (error) {
      session.actor.dispatch({ type: "command.rejected", commandId, operationId, error: redactSecretText(error instanceof Error ? error.message : String(error)) });
      throw error;
    }
  }

  async function interruptTurn(sender, request, workspaceRoot = null) {
    const session = runtimeSession.requireOwnedSession(sender, request?.sessionId);
    requireMatchingWorkspace(session, workspaceRoot);
    requireCommandPreconditions(session, request);
    const commandId = commandIdentity(request?.commandId);
    const repeated = repeatedCommand(session, request?.commandId, "interrupt");
    if (repeated) return { ...commandReceipt(session, repeated), interruptRequested: true };
    runtimeSession.requireConnectedSession(session);
    const turnId = normalizeRequiredId(request?.turnId, "Turn id");
    if (session.activeTurnId !== turnId) throw new Error("That Agent turn is no longer running.");
    if (session.interruptingTurnId === turnId) {
      const operationId = operationIdentity(commandId);
      session.actor.dispatch({ type: "command.received", command: { commandId, kind: "interrupt", status: "dispatching", targetTurnId: turnId, operationId } });
      session.actor.dispatch({ type: "command.accepted", commandId, operationId, turnId });
      return { sessionId: session.id, commandId, turnId, interruptRequested: true, deduplicated: true };
    }
    session.actor.dispatch({ type: "interrupt.requested", commandId, turnId });
    const operationId = operationIdentity(commandId);
    session.actor.dispatch({ type: "command.dispatching", commandId, operationId });
    try {
      await session.adapter.interruptTurn({ turnId });
    } catch (error) {
      session.actor.dispatch({ type: "command.rejected", commandId, operationId, error: redactSecretText(error instanceof Error ? error.message : String(error)) });
      runtimeSession.clearInterruptFallback(session);
      throw new Error(redactSecretText(error instanceof Error ? error.message : String(error)));
    }
    session.actor.dispatch({ type: "command.accepted", commandId, operationId, turnId });
    // Keep blocking requests actionable until the runtime accepts interruption.
    runtimeSession.failPendingApprovalsClosed(session, "turn-interrupted");
    runtimeSession.failPendingQuestionsClosed(session, "turn-interrupted");
    if (session.activeTurnId === turnId) runtimeSession.scheduleInterruptFallback(session, turnId);
    return { sessionId: session.id, commandId, turnId, interruptRequested: true };
  }

  async function resolveQuestion(sender, request, workspaceRoot = null) {
    const session = runtimeSession.requireOwnedSession(sender, request?.sessionId);
    requireMatchingWorkspace(session, workspaceRoot);
    requireCommandPreconditions(session, request);
    const commandId = commandIdentity(request?.commandId);
    const repeated = repeatedCommand(session, request?.commandId, "question");
    if (repeated) return { ...commandReceipt(session, repeated), requestId: request?.requestId };
    const turnId = normalizeRequiredId(request?.turnId, "Turn id");
    const requestId = normalizeRequiredId(request?.requestId, "Question request id");
    const pending = session.pendingQuestions.get(requestId);
    if (!pending) throw new Error("This question is stale or already resolved.");
    if (pending.turnId !== turnId || pending.runtimeId !== session.runtimeId) {
      throw new Error("Question correlation does not match the active request.");
    }
    if (!session.capabilities?.structuredQuestions || typeof session.adapter?.resolveQuestion !== "function") {
      throw new Error("The active Agent runtime does not support structured questions.");
    }
    const answers = normalizeQuestionAnswers(request?.answers ?? request?.answer, pending.questions);
    const rejected = request?.rejected === true || answers === null;
    session.actor.dispatch({ type: "command.received", command: { commandId, kind: "question", status: "dispatching", targetTurnId: turnId } });
    const operationId = operationIdentity(commandId);
    session.actor.dispatch({ type: "command.dispatching", commandId, operationId });
    try {
      await session.adapter.resolveQuestion({ requestId, answers: answers ?? [], rejected, turnId });
      session.actor.dispatch({ type: "command.accepted", commandId, operationId, turnId });
    } catch (error) {
      session.actor.dispatch({ type: "command.rejected", commandId, operationId, error: redactSecretText(error instanceof Error ? error.message : String(error)) });
      throw error;
    }
    if (session.pendingQuestions.has(requestId)) {
      emit(session, {
        type: "question.resolved",
        providerSessionId: session.providerSessionId,
        turnId,
        itemId: pending.itemId,
        payload: { requestId, resolution: rejected ? "rejected" : "answered" },
      });
    }
    return { sessionId: session.id, commandId, requestId, resolution: rejected ? "rejected" : "answered" };
  }

  function resolveApproval(sender, request, workspaceRoot = null) {
    const session = runtimeSession.requireOwnedSession(sender, request?.sessionId);
    requireMatchingWorkspace(session, workspaceRoot);
    requireCommandPreconditions(session, request);
    const commandId = commandIdentity(request?.commandId);
    const repeated = repeatedCommand(session, request?.commandId, "approval");
    if (repeated) return { ...commandReceipt(session, repeated), requestId: request?.requestId, decision: request?.decision };
    const requestId = normalizeRequiredId(request?.requestId, "Approval request id");
    const pending = session.pendingApprovals.get(requestId);
    if (!pending) throw new Error("This approval is stale or already resolved.");
    const turnId = normalizeRequiredId(request?.turnId, "Turn id");
    if (pending.turnId !== turnId || pending.runtimeId !== session.runtimeId) {
      throw new Error("Approval correlation does not match the active request.");
    }
    const decision = normalizeApprovalDecision(request?.decision);
    session.actor.dispatch({ type: "command.received", command: { commandId, kind: "approval", status: "dispatching", targetTurnId: turnId } });
    const operationId = operationIdentity(commandId);
    session.actor.dispatch({ type: "command.dispatching", commandId, operationId });
    const finalize = () => {
      session.actor.dispatch({ type: "command.accepted", commandId, operationId, turnId });
      if (session.pendingApprovals.has(requestId)) {
        emit(session, {
          type: "approval.resolved",
          providerSessionId: session.providerSessionId,
          turnId,
          itemId: pending.itemId,
          payload: { requestId, decision },
        });
      }
      return { sessionId: session.id, commandId, requestId, decision };
    };
    const reject = (error) => {
      session.actor.dispatch({ type: "command.rejected", commandId, operationId, error: redactSecretText(error instanceof Error ? error.message : String(error)) });
      throw error;
    };
    let resolution;
    try {
      resolution = session.adapter.resolveApproval({
        requestId,
        decision,
        threadId: session.providerSessionId,
        turnId,
      });
    } catch (error) {
      return reject(error);
    }
    return resolution && typeof resolution.then === "function"
      ? resolution.then(finalize, reject)
      : finalize();
  }

  function replay(sender, request, workspaceRoot = null) {
    const session = runtimeSession.requireOwnedSession(sender, request?.sessionId);
    requireMatchingWorkspace(session, workspaceRoot);
    const afterSequence = normalizeSequence(request?.afterSequence);
    const firstSequence = session.events[0]?.sequence ?? session.sequence + 1;
    const actorSnapshot = session.actor.snapshot();
    const events = actorSnapshot.timeline.events.filter((event) => event.sequence > afterSequence);
    return {
      session: sessionMetadata(session),
      account: session.account,
      models: session.models,
      capabilities: session.capabilities,
      modes: session.modes,
      commands: session.commands,
      runtime: session.runtime,
      cursor: actorSnapshot.cursor,
      control: actorSnapshot.control,
      timeline: {
        ...actorSnapshot.timeline,
        events,
      },
      events,
      partial: afterSequence > 0 && afterSequence < firstSequence - 1,
      firstAvailableSequence: firstSequence,
      lastSequence: session.sequence,
    };
  }

  function getReferenceInputCapabilities(sender, sessionId, workspaceRoot = null) {
    const session = runtimeSession.requireOwnedSession(sender, normalizeRequiredId(sessionId, "Agent session id"));
    requireMatchingWorkspace(session, workspaceRoot);
    return session.capabilities?.referenceInputs ? { ...session.capabilities.referenceInputs } : null;
  }

  function observeQueue(session) {
    if (observedSessions.has(session.id)) return;
    observedSessions.set(session.id, session.actor.subscribe(() => {
      if (session.actor.control.connection.status === "exited" || session.actor.control.connection.status === "disconnected") {
        void discardQueuedSession(session);
        return;
      }
      scheduleQueueDrain(session);
    }));
  }

  function scheduleQueueDrain(session) {
    if (drainingSessions.has(session.id)) return;
    const control = session.actor.control;
    if (control.execution.activeTurnId || control.execution.status === "starting" || control.queue.length === 0) return;
    drainingSessions.add(session.id);
    queueMicrotask(async () => {
      try {
        const commandId = session.actor.control.queue[0];
        const context = queuedStarts.get(commandId);
        if (!context || context.session !== session || session.providerExited) return;
        queuedStarts.delete(commandId);
        try { await executeStart(context); } catch { /* rejection is recorded in control state */ }
      } finally {
        drainingSessions.delete(session.id);
        if (!session.providerExited) scheduleQueueDrain(session);
      }
    });
  }

  async function discardQueuedSession(session) {
    const abandoned = Array.from(queuedStarts.values()).filter((context) => context.session === session);
    for (const context of abandoned) {
      queuedStarts.delete(context.commandId);
      await releaseQueuedLease(session, context.request);
    }
    observedSessions.get(session.id)?.();
    observedSessions.delete(session.id);
  }

  async function releaseQueuedLease(session, request) {
    const lease = request?.privateReferenceLease;
    const tokens = privateReferenceLeaseTokens(request);
    if (!lease?.leaseId || tokens.length === 0 || typeof attachmentStore?.releaseLease !== "function") return;
    await attachmentStore.releaseLease({
      ownerId: session.ownerId,
      workspaceRoot: session.workspaceRoot,
      tokens,
      leaseId: lease.leaseId,
    }).catch(() => undefined);
  }

  return {
    getReferenceInputCapabilities,
    interruptTurn,
    replay,
    resolveApproval,
    resolveQuestion,
    startTurn,
    steerTurn,
  };
}

function commandIdentity(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
    ? value
    : `command-${randomUUID()}`;
}

function requireCommandPreconditions(session, request) {
  const control = session.actor.control;
  if (request?.expectedSessionEpoch !== undefined && request.expectedSessionEpoch !== control.sessionEpoch) {
    throw new Error("The Agent command belongs to an older session generation.");
  }
  if (request?.expectedAdapterGeneration !== undefined && request.expectedAdapterGeneration !== control.adapterGeneration) {
    throw new Error("The Agent command belongs to a replaced runtime connection.");
  }
  if (request?.expectedRunGeneration !== undefined && request.expectedRunGeneration !== control.runGeneration) {
    throw new Error("The Agent command belongs to an older turn generation.");
  }
}

function repeatedCommand(session, commandId, kind) {
  if (typeof commandId !== "string") return null;
  const existing = session.actor.control.commands.find((entry) => entry.commandId === commandId);
  if (!existing) return null;
  if (existing.kind !== kind) throw new Error("Agent command id was already used for a different operation.");
  if (existing.status === "rejected" || existing.status === "outcome-unknown") {
    throw new Error(`Agent command was already ${existing.status} and will not be retried automatically.`);
  }
  return existing;
}

function commandReceipt(session, command) {
  return {
    sessionId: session.id,
    commandId: command.commandId,
    turnId: command.targetTurnId,
    queued: command.status === "queued",
    deliveryStatus: command.status,
    deduplicated: true,
  };
}

function operationIdentity(_commandId) {
  return `operation-${randomUUID()}`;
}

export const agentTurnCoordinatorLimits = Object.freeze({ maxQueuedTurns: MAX_QUEUED_TURNS });
