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
  withAgentSteerReferenceTokens,
} from "../agent-reference-policy.mjs";
import { sessionMetadata } from "../../domain/agent-session-model.mjs";
import {
  commandFingerprint,
  commandIdentity,
  commandReceipt,
  operationIdentity,
  repeatedCommand,
  requireCommandPreconditions,
  startCommandIntent,
} from "./agent-command-policy.mjs";
import { agentTurnQueueLimits, createAgentTurnQueue } from "./agent-turn-queue.mjs";

/** Owns user-driven turn and blocking-interaction commands for live sessions. */
export function createAgentTurnCoordinator({
  runtimeSession,
  emit,
  persistSoon,
  attachmentStore = null,
}) {
  const turnQueue = createAgentTurnQueue({ attachmentStore, executeStart });

  async function startTurn(sender, request, workspaceRoot = null) {
    const session = runtimeSession.requireOwnedSession(sender, request?.sessionId);
    requireMatchingWorkspace(session, workspaceRoot);
    requireCommandPreconditions(session, request);
    const commandId = commandIdentity(request?.commandId);
    const model = normalizeOptionalString(request?.model) || session.selectedModel;
    const effort = normalizeOptionalString(request?.effort) || session.selectedEffort;
    const mode = normalizeOptionalString(request?.mode) || session.selectedMode;
    const deliveryForReference = typeof session.adapter?.referenceMentionDelivery === "function"
      ? (reference) => session.adapter.referenceMentionDelivery(reference)
      : undefined;
    const preparedInput = prepareAgentTurnReferenceInput(request, session.capabilities, deliveryForReference);
    const publicIntent = startCommandIntent(preparedInput, { model, effort, mode });
    const fingerprint = commandFingerprint("start", {
      ...publicIntent,
      references: preparedInput.references,
    });
    const repeated = repeatedCommand(session, request?.commandId, "start", fingerprint);
    if (repeated) return commandReceipt(session, repeated);
    runtimeSession.requireConnectedSession(session);
    runtimeSession.requireAvailableModel(session, model);
    runtimeSession.requireAvailableEffort(session, model, effort);
    if (session.activeTurnId || session.turnStarting || session.interruptingTurnId) {
      if (!session.capabilities?.queue) throw new Error("An Agent turn is already running or stopping.");
      if (session.actor.control.queue.length >= agentTurnQueueLimits.maxQueuedTurns) {
        throw new Error(`Agent prompt queue is full (${agentTurnQueueLimits.maxQueuedTurns}).`);
      }
      session.actor.dispatch({
        type: "command.received",
        command: {
          commandId,
          kind: "start",
          status: "queued",
          targetTurnId: null,
          intentFingerprint: fingerprint,
          intent: publicIntent,
        },
      });
      turnQueue.enqueue({
        session,
        request: { ...request },
        preparedInput,
        model,
        effort,
        mode,
        commandId,
        queued: true,
      });
      return { sessionId: session.id, commandId, queued: true, turnId: session.activeTurnId };
    }
    session.actor.dispatch({
      type: "command.received",
      command: {
        commandId,
        kind: "start",
        status: "dispatching",
        targetTurnId: null,
        intentFingerprint: fingerprint,
        intent: publicIntent,
      },
    });
    return executeStart({ session, request, preparedInput, model, effort, mode, commandId, queued: false });
  }

  async function executeStart({ session, request, preparedInput, model, effort, mode, commandId, queued }) {
    const operationGeneration = session.actor.control.adapterGeneration;
    const operationId = operationIdentity(commandId);
    session.actor.dispatch({ type: "command.dispatching", commandId, operationId });
    const operationIdentityFields = { commandId, operationId, adapterGeneration: operationGeneration };
    try {
      const { references, referenceDisplays, prompt, displayPrompt, promptMentions } = beginAgentTurnReferences(
        session,
        request,
        operationIdentityFields,
        preparedInput,
      );
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
      abandonAgentTurnReferences(session, operationIdentityFields);
      session.actor.dispatch({
        type: "command.rejected",
        commandId,
        operationId,
        error: redactSecretText(error instanceof Error ? error.message : String(error)),
      });
      if (queued) await releaseQueuedLease(session, request);
      throw new Error(redactSecretText(error instanceof Error ? error.message : String(error)));
    } finally {
      turnQueue.schedule(session);
    }
  }

  async function steerTurn(sender, request, workspaceRoot = null) {
    const session = runtimeSession.requireOwnedSession(sender, request?.sessionId);
    requireMatchingWorkspace(session, workspaceRoot);
    requireCommandPreconditions(session, request);
    const commandId = commandIdentity(request?.commandId);
    const turnId = normalizeRequiredId(request?.turnId, "Turn id");
    const deliveryForReference = typeof session.adapter?.referenceMentionDelivery === "function"
      ? (reference) => session.adapter.referenceMentionDelivery(reference)
      : undefined;
    const { message, references, promptMentions } = prepareAgentSteerReferenceInput(request, session.capabilities, deliveryForReference);
    const fingerprint = commandFingerprint("steer", { turnId, message, references, promptMentions });
    const repeated = repeatedCommand(session, request?.commandId, "steer", fingerprint);
    if (repeated) return { ...commandReceipt(session, repeated), steered: true };
    runtimeSession.requireConnectedSession(session);
    if (session.activeTurnId !== turnId) throw new Error("That Agent turn is no longer running.");
    if (!session.capabilities?.steer || typeof session.adapter.steerTurn !== "function") {
      throw new Error("The active Agent runtime does not support steering a running turn.");
    }
    session.actor.dispatch({
      type: "command.received",
      command: { commandId, kind: "steer", status: "dispatching", targetTurnId: turnId, intentFingerprint: fingerprint },
    });
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
    const turnId = normalizeRequiredId(request?.turnId, "Turn id");
    const fingerprint = commandFingerprint("interrupt", { turnId });
    const repeated = repeatedCommand(session, request?.commandId, "interrupt", fingerprint);
    if (repeated) return { ...commandReceipt(session, repeated), interruptRequested: true };
    runtimeSession.requireConnectedSession(session);
    if (session.activeTurnId !== turnId) throw new Error("That Agent turn is no longer running.");
    if (session.interruptingTurnId === turnId) {
      const operationId = operationIdentity(commandId);
      session.actor.dispatch({
        type: "command.received",
        command: { commandId, kind: "interrupt", status: "dispatching", targetTurnId: turnId, operationId, intentFingerprint: fingerprint },
      });
      session.actor.dispatch({ type: "command.accepted", commandId, operationId, turnId });
      return { sessionId: session.id, commandId, turnId, interruptRequested: true, deduplicated: true };
    }
    session.actor.dispatch({ type: "interrupt.requested", commandId, turnId, intentFingerprint: fingerprint });
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
    const turnId = normalizeRequiredId(request?.turnId, "Turn id");
    const requestId = normalizeRequiredId(request?.requestId, "Question request id");
    const fingerprint = commandFingerprint("question", {
      turnId,
      requestId,
      answers: request?.answers ?? request?.answer ?? null,
      rejected: request?.rejected === true,
    });
    const repeated = repeatedCommand(session, request?.commandId, "question", fingerprint);
    if (repeated) return { ...commandReceipt(session, repeated), requestId };
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
    session.actor.dispatch({
      type: "command.received",
      command: { commandId, kind: "question", status: "dispatching", targetTurnId: turnId, intentFingerprint: fingerprint },
    });
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
    const requestId = normalizeRequiredId(request?.requestId, "Approval request id");
    const turnId = normalizeRequiredId(request?.turnId, "Turn id");
    const decision = normalizeApprovalDecision(request?.decision);
    const fingerprint = commandFingerprint("approval", { requestId, turnId, decision });
    const repeated = repeatedCommand(session, request?.commandId, "approval", fingerprint);
    if (repeated) return { ...commandReceipt(session, repeated), requestId, decision };
    const pending = session.pendingApprovals.get(requestId);
    if (!pending) throw new Error("This approval is stale or already resolved.");
    if (pending.turnId !== turnId || pending.runtimeId !== session.runtimeId) {
      throw new Error("Approval correlation does not match the active request.");
    }
    session.actor.dispatch({
      type: "command.received",
      command: { commandId, kind: "approval", status: "dispatching", targetTurnId: turnId, intentFingerprint: fingerprint },
    });
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

export const agentTurnCoordinatorLimits = agentTurnQueueLimits;
