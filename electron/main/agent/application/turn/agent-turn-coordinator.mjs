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
  abandonAgentSteerReferences,
  acceptAgentSteerReferences,
  beginAgentSteerReferences,
  prepareAgentTurnReferenceInput,
  prepareAgentSteerReferenceInput,
  releaseAgentReferenceLease,
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
import {
  isAgentDeliveryOutcomeUnknown,
} from "./agent-command-outcome-policy.mjs";
import { executeAgentStartTransaction } from "./agent-start-transaction.mjs";
import { agentTurnQueueLimits, createAgentTurnQueue } from "./agent-turn-queue.mjs";

/** Owns user-driven turn and blocking-interaction commands for live sessions. */
export function createAgentTurnCoordinator({
  runtimeSession,
  emit,
  persistSoon,
  attachmentStore = null,
}) {
  const turnQueue = createAgentTurnQueue({
    attachmentStore,
    executeStart: (context) => executeAgentStartTransaction(context, {
      runtimeSession,
      emit,
      persistSoon,
      attachmentStore,
      onSettled: (session) => turnQueue.schedule(session),
    }),
  });

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
    const operationId = operationIdentity(commandId);
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
          operationId,
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
        operationId,
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
        operationId,
        intentFingerprint: fingerprint,
        intent: publicIntent,
      },
    });
    return executeAgentStartTransaction(
      { session, request, preparedInput, model, effort, mode, commandId, operationId },
      { runtimeSession, emit, persistSoon, attachmentStore, onSettled: (current) => turnQueue.schedule(current) },
    );
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
    const preparedInput = prepareAgentSteerReferenceInput(request, session.capabilities, deliveryForReference);
    const { message, references, promptMentions } = preparedInput;
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
    const operationIdentityFields = {
      commandId,
      operationId,
      adapterGeneration: session.actor.control.adapterGeneration,
    };
    session.actor.dispatch({ type: "command.dispatching", commandId, operationId });
    beginAgentSteerReferences(session, request, operationIdentityFields, preparedInput);
    try {
      await session.adapter.steerTurn({ turnId, message, references });
      const accepted = session.actor.dispatch({ type: "command.accepted", commandId, operationId, turnId });
      if (!accepted.changed) {
        return { sessionId: session.id, commandId, turnId, steered: true, outcomeUnknown: true };
      }
      acceptAgentSteerReferences(session, operationIdentityFields, turnId);
      return { sessionId: session.id, commandId, turnId, steered: true };
    } catch (error) {
      const message = redactSecretText(error instanceof Error ? error.message : String(error));
      if (isAgentDeliveryOutcomeUnknown(error)) {
        session.actor.dispatch({ type: "command.outcome-unknown", commandId, operationId, error: message });
        return { sessionId: session.id, commandId, turnId, steered: true, outcomeUnknown: true };
      }
      abandonAgentSteerReferences(session, operationIdentityFields);
      session.actor.dispatch({ type: "command.rejected", commandId, operationId, error: message });
      await releaseAgentReferenceLease(session, request, attachmentStore);
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
      const message = redactSecretText(error instanceof Error ? error.message : String(error));
      if (isAgentDeliveryOutcomeUnknown(error)) {
        session.actor.dispatch({ type: "command.outcome-unknown", commandId, operationId, error: message });
        if (session.activeTurnId === turnId) runtimeSession.scheduleInterruptFallback(session, turnId);
        return { sessionId: session.id, commandId, turnId, interruptRequested: true, outcomeUnknown: true };
      }
      session.actor.dispatch({ type: "command.rejected", commandId, operationId, error: message });
      runtimeSession.clearInterruptFallback(session);
      throw new Error(message);
    }
    const accepted = session.actor.dispatch({ type: "command.accepted", commandId, operationId, turnId });
    if (!accepted.changed) {
      return { sessionId: session.id, commandId, turnId, interruptRequested: true, outcomeUnknown: true };
    }
    // Keep blocking requests actionable until the runtime accepts interruption.
    runtimeSession.failPendingApprovalsForTurn(session, turnId, "turn-interrupted");
    runtimeSession.failPendingQuestionsForTurn(session, turnId, "turn-interrupted");
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
      const accepted = session.actor.dispatch({ type: "command.accepted", commandId, operationId, turnId });
      if (!accepted.changed) return { sessionId: session.id, commandId, requestId, outcomeUnknown: true };
    } catch (error) {
      const message = redactSecretText(error instanceof Error ? error.message : String(error));
      if (isAgentDeliveryOutcomeUnknown(error)) {
        session.actor.dispatch({ type: "command.outcome-unknown", commandId, operationId, error: message });
        return { sessionId: session.id, commandId, requestId, outcomeUnknown: true };
      }
      session.actor.dispatch({ type: "command.rejected", commandId, operationId, error: message });
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
      const accepted = session.actor.dispatch({ type: "command.accepted", commandId, operationId, turnId });
      if (!accepted.changed) return { sessionId: session.id, commandId, requestId, outcomeUnknown: true };
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
      const message = redactSecretText(error instanceof Error ? error.message : String(error));
      if (isAgentDeliveryOutcomeUnknown(error)) {
        session.actor.dispatch({ type: "command.outcome-unknown", commandId, operationId, error: message });
        return { sessionId: session.id, commandId, requestId, outcomeUnknown: true };
      }
      session.actor.dispatch({ type: "command.rejected", commandId, operationId, error: message });
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
