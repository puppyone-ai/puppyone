import { redactSecretText } from "../../agent-events.mjs";
import {
  abandonAgentTurnReferences,
  acceptAgentTurnReferences,
  beginAgentTurnReferences,
  releaseAgentReferenceLease,
  revokeAgentOperationReferences,
} from "../agent-reference-policy.mjs";
import {
  agentDeliveryOutcomeUnknownError,
  isAgentDeliveryOutcomeUnknown,
} from "./agent-command-outcome-policy.mjs";

/** Executes one already-reserved start command and settles every ownership path. */
export async function executeAgentStartTransaction(context, {
  runtimeSession,
  emit,
  persistSoon,
  attachmentStore,
  onSettled,
}) {
  const { session, request, preparedInput, model, effort, mode, commandId, operationId } = context;
  const adapterGeneration = session.actor.control.adapterGeneration;
  const identity = { commandId, operationId, adapterGeneration };
  try {
    const { references, referenceDisplays, prompt, displayPrompt, promptMentions } = beginAgentTurnReferences(
      session,
      request,
      identity,
      preparedInput,
    );
    session.selectedModel = model;
    session.selectedEffort = effort;
    session.selectedMode = mode;
    const result = await session.adapter.startTurn({
      prompt,
      clientUserMessageId: session.actor.control.commands.find(entry => entry.commandId === commandId)?.userMessageId,
      model,
      ...(effort ? { effort } : {}),
      mode,
      references,
      attachments: references.filter((entry) => entry.kind === "staged-attachment"),
      contextReferences: references.filter((entry) => entry.kind === "workspace-entry"),
    });
    if (!runtimeSession.isCurrent(session)
      || session.actor.control.adapterGeneration !== adapterGeneration
      || ["exited", "disconnected"].includes(session.actor.control.connection.status)) {
      throw agentDeliveryOutcomeUnknownError("The Agent session changed before turn acceptance could be confirmed.");
    }
    const terminalOutcome = session.actor.terminalOutcome(result.turnId);
    if (!terminalOutcome && session.lastStartedTurnId !== result.turnId) {
      emit(session, {
        type: "turn.started",
        providerSessionId: session.providerSessionId,
        turnId: result.turnId,
        payload: {
          status: "running",
          prompt: displayPrompt,
          ...(request.recoveryOfTurnId ? { recoveryOfTurnId: request.recoveryOfTurnId } : {}),
          userMessageId: session.actor.control.commands.find(entry => entry.commandId === commandId)?.userMessageId,
          submissionId: commandId,
          model,
          effort,
          mode,
          referenceDisplays,
          promptMentions,
        },
      });
    }
    const accepted = session.actor.dispatch({
      type: "submission.accepted",
      ...identity,
      turnId: result.turnId,
      userMessageId: session.actor.control.commands.find(entry => entry.commandId === commandId)?.userMessageId ?? null,
      terminalOutcome,
    });
    if (!accepted.changed) {
      throw agentDeliveryOutcomeUnknownError("The Agent start receipt no longer matches the active operation.");
    }
    if (terminalOutcome) await revokeAgentOperationReferences(session, identity, attachmentStore);
    else acceptAgentTurnReferences(session, identity, result.turnId);
    persistSoon(session);
    return { sessionId: session.id, commandId, queued: false, turnId: result.turnId };
  } catch (error) {
    const confirmed = session.actor.control.commands.find(command => command.commandId === commandId && command.operationId === operationId && command.status === "accepted");
    if (confirmed?.targetTurnId && runtimeSession.isCurrent(session) && session.actor.control.adapterGeneration === adapterGeneration) {
      // Correlated native execution is stronger evidence than a missing RPC receipt.
      if (session.actor.terminalOutcome(confirmed.targetTurnId)) await revokeAgentOperationReferences(session, identity, attachmentStore);
      else acceptAgentTurnReferences(session, identity, confirmed.targetTurnId);
      persistSoon(session);
      return { sessionId: session.id, commandId, queued: false, turnId: confirmed.targetTurnId };
    }
    const message = redactSecretText(error instanceof Error ? error.message : String(error));
    if (isAgentDeliveryOutcomeUnknown(error)) {
      session.actor.dispatch({
        type: "submission.outcome-unknown",
        ...identity,
        error: message,
        userMessageId: agentUserMessageIdentity(error),
      });
      return { sessionId: session.id, commandId, queued: false, turnId: null, outcomeUnknown: true };
    }
    abandonAgentTurnReferences(session, identity);
    session.actor.dispatch({ type: "command.rejected", commandId, operationId, error: message });
    await releaseAgentReferenceLease(session, request, attachmentStore);
    throw new Error(message);
  } finally {
    onSettled(session);
  }
}

function agentUserMessageIdentity(error) {
  const value = error?.clientUserMessageId;
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/.test(value) ? value : null;
}
