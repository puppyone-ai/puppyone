import { historyCursor, historyNativeId } from "./history-schema.mjs";
import { assertAgentDisplay, assertAgentDisplayPatch } from "./display-schema.mjs";
import { parseWorkspaceResourceReference } from "../workspace-resource-reference.mjs";
import { AGENT_SESSION_OPEN_ERROR_CODES, agentContractLimits } from "./constants.mjs";
import { assertAgentEventEnvelope } from "./event-schema.mjs";
import { sanitizeAgentLocalConnectionsSnapshot } from "./local-connection-schema.mjs";
import {
  assertAgentInspection,
  assertAgentInferenceProvider,
  assertAgentModel,
  sanitizeAgentRuntimeDescriptor,
} from "./runtime-schema.mjs";
import {
  assertArray,
  assertRecord,
  assertRuntimeId,
  compact,
  contractError,
  enumValue,
  nonNegativeInteger,
  positiveInteger,
  optionalBoolean,
  optionalOpaqueId,
  optionalRecord,
  optionalRuntimeId,
  optionalString,
  requiredOpaqueId,
  requiredString,
} from "./validation.mjs";
import { normalizeAgentWorkspaceRelativePath } from "./reference-identity.mjs";

export * from "./constants.mjs";
export * from "./event-schema.mjs";
export * from "./event-content-update.mjs";
export * from "./local-connection-schema.mjs";
export * from "./runtime-schema.mjs";

const {
  maxPathLength: MAX_PATH_LENGTH,
  maxMessageLength: MAX_MESSAGE_LENGTH,
  maxControlReasonLength: MAX_CONTROL_REASON_LENGTH,
  maxCommandErrorLength: MAX_COMMAND_ERROR_LENGTH,
  maxCommandFingerprintLength: MAX_COMMAND_FINGERPRINT_LENGTH,
  maxReferenceCount: MAX_REFERENCE_COUNT,
} = agentContractLimits;

export function parseAgentIpcRequest(channel, value) {
  const input = optionalRecord(value, channel);
  switch (channel) {
    case "agent:providers-discover":
    case "agent:local-connections-discover":
    case "agent:models-list":
    case "agent:account-read":
      return compact({
        rootPath: optionalString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        runtimeId: optionalRuntimeId(input.runtimeId),
        refresh: optionalBoolean(input.refresh, "refresh"),
      });
    case "agent:session-create":
      return compact({
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        runtimeId: optionalRuntimeId(input.runtimeId),
        model: optionalString(input.model, "model", 512),
        effort: optionalString(input.effort, "effort", 160),
        mode: optionalString(input.mode, "mode", 160),
      });
    case "agent:session-resume":
      return compact({
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: optionalOpaqueId(input.sessionId, "sessionId"),
        runtimeId: optionalRuntimeId(input.runtimeId),
      });
    case "agent:session-open":
      return {
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: requiredOpaqueId(input.sessionId, "sessionId"),
        runtimeId: assertRuntimeId(input.runtimeId, "runtimeId"),
      };
    case "agent:session-replay":
      return {
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: requiredOpaqueId(input.sessionId, "sessionId"),
        afterSequence: nonNegativeInteger(input.afterSequence, "afterSequence"),
      };
    case "agent:session-attach":
      return {
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: requiredOpaqueId(input.sessionId, "sessionId"),
      };
    case "agent:session-feed-ack":
      return {
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: requiredOpaqueId(input.sessionId, "sessionId"),
        subscriptionId: requiredOpaqueId(input.subscriptionId, "subscriptionId"),
        streamId: requiredOpaqueId(input.streamId, "streamId"),
        revision: nonNegativeInteger(input.revision, "revision"),
      };
    case "agent:session-feed-watermark":
    case "agent:session-detach":
      return {
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: requiredOpaqueId(input.sessionId, "sessionId"),
        subscriptionId: requiredOpaqueId(input.subscriptionId, "subscriptionId"),
      };
    case "agent:sessions-list":
      return compact({
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        runtimeId: optionalRuntimeId(input.runtimeId),
        includeArchived: optionalBoolean(input.includeArchived, "includeArchived"),
        discoverNative: optionalBoolean(input.discoverNative, "discoverNative"),
        catalogCursor: historyCursor(input.catalogCursor) ?? undefined,
        cursor: historyCursor(input.cursor) ?? undefined,
        scanId: optionalOpaqueId(input.scanId, "scanId"),
        limit: optionalPageSize(input.limit, "limit"),
      });
    case "agent:session-fork":
    case "agent:session-archive":
    case "agent:session-delete":
      return compact({
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: requiredOpaqueId(input.sessionId, "sessionId"),
        messageId: optionalOpaqueId(input.messageId, "messageId"),
        archiveNative: optionalBoolean(input.archiveNative, "archiveNative"),
        deleteNative: optionalBoolean(input.deleteNative, "deleteNative"),
      });
    case "agent:session-close":
      return compact({
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: requiredOpaqueId(input.sessionId, "sessionId"),
        removePersistence: optionalBoolean(input.removePersistence, "removePersistence"),
      });
    case "agent:reference-stage":
      return {
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        epoch: requiredOpaqueId(input.epoch, "epoch"),
        sourcePaths: boundedStringArray(input.sourcePaths, "sourcePaths", MAX_REFERENCE_COUNT, MAX_PATH_LENGTH),
      };
    case "agent:reference-revoke":
      return {
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        tokens: boundedOpaqueIdArray(input.tokens, "tokens", MAX_REFERENCE_COUNT),
      };
    case "agent:reference-resolve-workspace":
      return {
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        paths: boundedStringArray(input.paths, "paths", MAX_REFERENCE_COUNT, 16_384),
      };
    case "agent:reference-pick-workspace":
      return { rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH) };
    case "agent:command-dispatch": {
      const kind = enumValue(input.kind, "kind", ["start", "steer", "interrupt", "approval", "question"]);
      const channelForKind = {
        start: "agent:turn-start",
        steer: "agent:turn-steer",
        interrupt: "agent:turn-interrupt",
        approval: "agent:approval-resolve",
        question: "agent:question-resolve",
      };
      return { kind, ...parseAgentIpcRequest(channelForKind[kind], input) };
    }
    case "agent:turn-start":
      return compact({
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: requiredOpaqueId(input.sessionId, "sessionId"),
        commandId: optionalOpaqueId(input.commandId, "commandId"),
        ...commandPreconditions(input),
        prompt: requiredString(input.prompt, "prompt", MAX_MESSAGE_LENGTH, { allowEmpty: true, preserveWhitespace: true }),
        model: optionalString(input.model, "model", 512),
        effort: optionalString(input.effort, "effort", 160),
        mode: optionalString(input.mode, "mode", 160),
        referenceEpoch: optionalOpaqueId(input.referenceEpoch, "referenceEpoch"),
        attachments: optionalReferences(input.attachments, "attachments"),
        contextReferences: optionalReferences(input.contextReferences, "contextReferences"),
        references: optionalDraftReferences(input.references, "references"),
        promptMentions: optionalPromptMentions(input.promptMentions, "promptMentions"),
      });
    case "agent:turn-steer":
      return {
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: requiredOpaqueId(input.sessionId, "sessionId"),
        turnId: requiredOpaqueId(input.turnId, "turnId"),
        commandId: optionalOpaqueId(input.commandId, "commandId"),
        ...commandPreconditions(input),
        message: requiredString(input.message, "message", MAX_MESSAGE_LENGTH, { allowEmpty: true, preserveWhitespace: true }),
        referenceEpoch: optionalOpaqueId(input.referenceEpoch, "referenceEpoch"),
        references: optionalDraftReferences(input.references, "references"),
        promptMentions: optionalPromptMentions(input.promptMentions, "promptMentions"),
      };
    case "agent:turn-interrupt":
    case "agent:session-compact":
      return compact({
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: requiredOpaqueId(input.sessionId, "sessionId"),
        commandId: optionalOpaqueId(input.commandId, "commandId"),
        ...(channel === "agent:turn-interrupt" ? commandPreconditions(input) : {}),
        turnId: channel === "agent:turn-interrupt" ? requiredOpaqueId(input.turnId, "turnId") : undefined,
      });
    case "agent:approval-resolve":
      return {
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: requiredOpaqueId(input.sessionId, "sessionId"),
        turnId: requiredOpaqueId(input.turnId, "turnId"),
        requestId: requiredOpaqueId(input.requestId, "requestId"),
        commandId: optionalOpaqueId(input.commandId, "commandId"),
        ...commandPreconditions(input),
        decision: enumValue(input.decision, "decision", ["accept", "acceptForSession", "decline", "cancel"]),
      };
    case "agent:question-resolve":
      return compact({
        rootPath: requiredString(input.rootPath, "rootPath", MAX_PATH_LENGTH),
        sessionId: requiredOpaqueId(input.sessionId, "sessionId"),
        turnId: requiredOpaqueId(input.turnId, "turnId"),
        requestId: requiredOpaqueId(input.requestId, "requestId"),
        commandId: optionalOpaqueId(input.commandId, "commandId"),
        ...commandPreconditions(input),
        answer: optionalQuestionAnswer(input.answer, "answer"),
        answers: optionalAnswerMatrix(input.answers, "answers"),
        rejected: optionalBoolean(input.rejected, "rejected"),
      });
    default:
      throw new TypeError(`Unknown Agent IPC channel: ${String(channel)}`);
  }
}

export function assertAgentIpcResponse(channel, value) {
  switch (channel) {
    case "agent:providers-discover":
      return assertAgentInspection(value);
    case "agent:local-connections-discover":
      return sanitizeAgentLocalConnectionsSnapshot(value);
    case "agent:models-list":
      assertArray(value, "models").forEach(assertAgentModel);
      return value;
    case "agent:account-read":
      if (value !== null) assertRecord(value, "account state");
      return value;
    case "agent:session-create":
    case "agent:session-replay":
    case "agent:session-fork":
      return assertAgentSessionSnapshot(value);
    case "agent:session-resume":
      return value === null ? value : assertAgentSessionSnapshot(value);
    case "agent:session-attach": {
      const receipt = assertRecord(value, "Agent session feed receipt");
      requiredOpaqueId(receipt.subscriptionId, "subscriptionId");
      assertAgentSessionSnapshot(receipt.snapshot);
      return value;
    }
    case "agent:session-open":
      return sanitizeAgentSessionOpenResult(value);
    case "agent:sessions-list":
      return sanitizeAgentSessionsListResponse(value);
    case "agent:session-archive":
    case "agent:session-delete":
    case "agent:session-close":
    case "agent:session-feed-ack":
    case "agent:session-feed-watermark":
    case "agent:session-detach":
    case "agent:reference-revoke":
    case "agent:command-dispatch":
    case "agent:turn-start":
    case "agent:turn-steer":
    case "agent:turn-interrupt":
    case "agent:session-compact":
    case "agent:approval-resolve":
    case "agent:question-resolve":
      assertRecord(value, `${channel} response`);
      return value;
    case "agent:reference-stage":
    case "agent:reference-resolve-workspace":
    case "agent:reference-pick-workspace":
      return assertArray(value, `${channel} response`)
        .map((entry, index) => sanitizeDraftReference(entry, `${channel}[${index}]`, false));
    default:
      throw new TypeError(`Unknown Agent IPC channel: ${String(channel)}`);
  }
}

function optionalPageSize(value, label) {
  if (value === undefined || value === null) return undefined;
  const normalized = nonNegativeInteger(value, label);
  if (normalized < 1 || normalized > 100) throw contractError(label, "must be between 1 and 100");
  return normalized;
}

export function assertAgentSessionSnapshot(value) {
  const snapshot = assertRecord(value, "Agent session snapshot");
  assertAgentSessionMetadata(snapshot.session);
  assertAgentDisplay(snapshot.display);
  assertArray(snapshot.providers ?? [], "Agent session providers").forEach(assertAgentInferenceProvider);
  assertArray(snapshot.models ?? [], "Agent session models").forEach(assertAgentModel);
  assertArray(snapshot.events, "Agent session events").forEach(assertAgentEventEnvelope);
  if (!Number.isSafeInteger(snapshot.firstAvailableSequence) || snapshot.firstAvailableSequence < 0) throw contractError("firstAvailableSequence", "must be a non-negative integer");
  if (!Number.isSafeInteger(snapshot.lastSequence) || snapshot.lastSequence < 0) throw contractError("lastSequence", "must be a non-negative integer");
  assertAgentSessionCursor(snapshot.cursor, "Agent session snapshot.cursor");
  assertAgentSessionControlView(snapshot.control, "Agent session snapshot.control");
  if (snapshot.timeline !== undefined) {
    const timeline = assertRecord(snapshot.timeline, "Agent session snapshot.timeline");
    assertArray(timeline.events, "Agent session snapshot.timeline.events").forEach(assertAgentEventEnvelope);
    if (timeline.checkpointEvents !== undefined) {
      assertArray(timeline.checkpointEvents, "Agent session snapshot.timeline.checkpointEvents").forEach(assertAgentEventEnvelope);
    }
    nonNegativeInteger(timeline.firstAvailableSequence, "Agent session snapshot.timeline.firstAvailableSequence");
    nonNegativeInteger(timeline.lastSequence, "Agent session snapshot.timeline.lastSequence");
  }
  if (snapshot.cursor && snapshot.control && (
    snapshot.cursor.streamId !== snapshot.control.streamId
    || snapshot.cursor.revision !== snapshot.control.revision
  )) throw contractError("Agent session snapshot.cursor", "must match the control state version");
  return value;
}

function assertAgentSessionCursor(value, label) {
  const cursor = assertRecord(value, label);
  requiredOpaqueId(cursor.streamId, `${label}.streamId`);
  nonNegativeInteger(cursor.revision, `${label}.revision`);
}

export function assertAgentSessionControl(value, label = "Agent session control") {
  return validateSessionControl(value, label, false);
}

export function assertAgentSessionControlView(value, label = "Agent control view") {
  validateSessionControl(value, label, true);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 1024 * 1024) throw contractError(label, "exceeds the control transport budget");
  return value;
}

function validateSessionControl(value, label, view) {
  const control = assertRecord(value, label);
  if (control.schemaVersion !== 1) throw contractError(`${label}.schemaVersion`, "must equal 1");
  requiredOpaqueId(control.streamId, `${label}.streamId`);
  requiredOpaqueId(control.sessionEpoch, `${label}.sessionEpoch`);
  nonNegativeInteger(control.revision, `${label}.revision`);
  nonNegativeInteger(control.adapterGeneration, `${label}.adapterGeneration`);
  nonNegativeInteger(control.runGeneration, `${label}.runGeneration`);
  const connection = assertRecord(control.connection, `${label}.connection`);
  enumValue(connection.status, `${label}.connection.status`, ["connecting", "connected", "recovering", "disconnected", "exited"]);
  if (connection.reason !== null && connection.reason !== undefined) optionalString(connection.reason, `${label}.connection.reason`, MAX_CONTROL_REASON_LENGTH);
  if (connection.recoveryState !== null && connection.recoveryState !== undefined) {
    enumValue(connection.recoveryState, `${label}.connection.recoveryState`, ["reconnecting", "fallback"]);
  }
  if (connection.attempt !== null && connection.attempt !== undefined) positiveInteger(connection.attempt, `${label}.connection.attempt`);
  if (connection.maxAttempts !== null && connection.maxAttempts !== undefined) positiveInteger(connection.maxAttempts, `${label}.connection.maxAttempts`);
  if (connection.status !== "recovering" && (
    connection.recoveryState != null || connection.attempt != null || connection.maxAttempts != null
  )) throw contractError(`${label}.connection`, "must not retain recovery details outside recovery");
  const recoveries = assertArray(control.recoveries ?? [], `${label}.recoveries`);
  if (recoveries.length > 64) throw contractError(`${label}.recoveries`, "exceeds the recovery budget");
  const recoveryIds = new Set();
  for (const entry of recoveries) {
    assertRecord(entry, "recovery");
    requiredOpaqueId(entry.id, "recovery.id");
    if (recoveryIds.has(entry.id)) throw contractError("recovery.id", "must be unique");
    recoveryIds.add(entry.id);
    enumValue(entry.scope, "recovery.scope", ["transport", "upstream-request"]);
    enumValue(entry.state, "recovery.state", ["reconnecting", "fallback"]);
    optionalOpaqueId(entry.turnId, "recovery.turnId", { nullable: true });
    optionalOpaqueId(entry.requestId, "recovery.requestId", { nullable: true });
    nonNegativeInteger(entry.adapterGeneration, "recovery.adapterGeneration");
    nonNegativeInteger(entry.runGeneration, "recovery.runGeneration");
    optionalString(entry.message, "recovery.message", MAX_CONTROL_REASON_LENGTH);
    if (entry.attempt !== null) positiveInteger(entry.attempt, "recovery.attempt");
    if (entry.maxAttempts !== null) positiveInteger(entry.maxAttempts, "recovery.maxAttempts");
  }
  const execution = assertRecord(control.execution, `${label}.execution`);
  enumValue(execution.status, `${label}.execution.status`, ["idle", "starting", "active", "ended", "outcome-unknown"]);
  optionalOpaqueId(execution.activeTurnId, `${label}.execution.activeTurnId`, { nullable: true });
  optionalOpaqueId(execution.uncertainTurnId, `${label}.execution.uncertainTurnId`, { nullable: true });
  if (execution.startedAtMs !== null && execution.startedAtMs !== undefined) nonNegativeInteger(execution.startedAtMs, `${label}.execution.startedAtMs`);
  if (execution.nativeOutcome !== null && execution.nativeOutcome !== undefined) {
    enumValue(execution.nativeOutcome, `${label}.execution.nativeOutcome`, ["completed", "failed", "interrupted"]);
  }
  enumValue(execution.certainty, `${label}.execution.certainty`, ["confirmed", "unknown"]);
  const commands = assertArray(control.commands, `${label}.commands`);
  const commandIds = new Set();
  commands.forEach((entry, index) => {
    const command = assertRecord(entry, `${label}.commands[${index}]`);
    const commandId = requiredOpaqueId(command.commandId, `${label}.commands[${index}].commandId`);
    if (commandIds.has(commandId)) throw contractError(`${label}.commands`, "must not contain duplicate command ids");
    commandIds.add(commandId);
    optionalOpaqueId(command.requestId, `${label}.commands[${index}].requestId`, { nullable: true });
    optionalOpaqueId(command.operationId, `${label}.commands[${index}].operationId`, { nullable: true });
    optionalOpaqueId(command.targetTurnId, `${label}.commands[${index}].targetTurnId`, { nullable: true });
    optionalOpaqueId(command.userMessageId, `${label}.commands[${index}].userMessageId`, { nullable: true });
    const kind = enumValue(command.kind, `${label}.commands[${index}].kind`, ["start", "steer", "interrupt", "approval", "question"]);
    enumValue(command.status, `${label}.commands[${index}].status`, ["queued", "dispatching", "accepted", "rejected", "cancelled", "outcome-unknown"]);
    if (command.error !== null && command.error !== undefined) optionalString(command.error, `${label}.commands[${index}].error`, MAX_COMMAND_ERROR_LENGTH);
    requiredString(command.intentFingerprint, `${label}.commands[${index}].intentFingerprint`, MAX_COMMAND_FINGERPRINT_LENGTH);
    if (typeof command.wasQueued !== "boolean") throw contractError(`${label}.commands[${index}].wasQueued`, "must be a boolean");
    if (view && command.intent !== undefined) throw contractError(label, "must not expose command input bodies");
    if (!view && kind === "start" && (["queued", "dispatching"].includes(command.status) || command.intent !== undefined)) {
      assertControlCommandIntent(command.intent, `${label}.commands[${index}].intent`);
    } else if (kind !== "start" && command.intent !== null && command.intent !== undefined) {
      throw contractError(`${label}.commands[${index}].intent`, "is only valid for start commands");
    }
  });
  const queue = assertArray(control.queue, `${label}.queue`).map((entry, index) => requiredOpaqueId(entry, `${label}.queue[${index}]`));
  if (new Set(queue).size !== queue.length) throw contractError(`${label}.queue`, "must not contain duplicate command ids");
  for (const commandId of queue) {
    if (!commands.some((command) => command.commandId === commandId && command.status === "queued")) {
      throw contractError(`${label}.queue`, "must reference queued command records");
    }
  }
  const interaction = assertRecord(control.interaction, `${label}.interaction`);
  assertArray(interaction.approvals, `${label}.interaction.approvals`).forEach((entry, index) => (
    assertControlBlocker(entry, `${label}.interaction.approvals[${index}]`, false, view)
  ));
  assertArray(interaction.questions, `${label}.interaction.questions`).forEach((entry, index) => (
    assertControlBlocker(entry, `${label}.interaction.questions[${index}]`, true, view)
  ));
  assertArray(control.terminalTurns, `${label}.terminalTurns`).forEach((entry, index) => requiredOpaqueId(entry, `${label}.terminalTurns[${index}]`));
  if (control.pendingSubmission !== null && control.pendingSubmission !== undefined) {
    const submission = assertRecord(control.pendingSubmission, `${label}.pendingSubmission`);
    requiredOpaqueId(submission.commandId, `${label}.pendingSubmission.commandId`);
    requiredOpaqueId(submission.operationId, `${label}.pendingSubmission.operationId`);
    nonNegativeInteger(submission.adapterGeneration, `${label}.pendingSubmission.adapterGeneration`);
    if (view) {
      if (["prompt", "promptMentions", "referenceDisplays"].some(key => key in submission)) throw contractError(label, "must not expose pending input bodies");
    } else {
      requiredString(submission.prompt, `${label}.pendingSubmission.prompt`, MAX_MESSAGE_LENGTH, { allowEmpty: true, preserveWhitespace: true });
      assertArray(submission.promptMentions, `${label}.pendingSubmission.promptMentions`);
      assertArray(submission.referenceDisplays, `${label}.pendingSubmission.referenceDisplays`);
    }
  }
  return value;
}

function assertControlCommandIntent(value, label) {
  const intent = assertRecord(value, label);
  requiredString(intent.prompt, `${label}.prompt`, MAX_MESSAGE_LENGTH, { allowEmpty: true, preserveWhitespace: true });
  assertControlPromptMentions(assertArray(intent.promptMentions ?? [], `${label}.promptMentions`), intent.prompt, `${label}.promptMentions`);
  assertControlReferenceDisplays(assertArray(intent.referenceDisplays ?? [], `${label}.referenceDisplays`), `${label}.referenceDisplays`);
  if (intent.model !== null && intent.model !== undefined) optionalString(intent.model, `${label}.model`, 512);
  if (intent.effort !== null && intent.effort !== undefined) optionalString(intent.effort, `${label}.effort`, 160);
  if (intent.mode !== null && intent.mode !== undefined) optionalString(intent.mode, `${label}.mode`, 160);
}

function assertControlPromptMentions(mentions, prompt, label) {
  if (mentions.length > MAX_REFERENCE_COUNT) throw contractError(label, `may contain at most ${MAX_REFERENCE_COUNT} entries`);
  mentions.forEach((entry, index) => {
    const mention = assertRecord(entry, `${label}[${index}]`);
    requiredOpaqueId(mention.referenceId, `${label}[${index}].referenceId`);
    const start = nonNegativeInteger(mention.start, `${label}[${index}].start`);
    const end = nonNegativeInteger(mention.end, `${label}[${index}].end`);
    if (end <= start || end > prompt.length) throw contractError(`${label}[${index}]`, "must identify a non-empty prompt range");
  });
}

function assertControlReferenceDisplays(displays, label) {
  if (displays.length > MAX_REFERENCE_COUNT) throw contractError(label, `may contain at most ${MAX_REFERENCE_COUNT} entries`);
  displays.forEach((entry, index) => {
    const display = assertRecord(entry, `${label}[${index}]`);
    requiredOpaqueId(display.id, `${label}[${index}].id`);
    enumValue(display.kind, `${label}[${index}].kind`, ["workspace-file", "workspace-directory", "attachment"]);
    requiredString(display.displayName, `${label}[${index}].displayName`, 512);
    if (display.relativePath !== undefined) requiredString(display.relativePath, `${label}[${index}].relativePath`, MAX_PATH_LENGTH);
    if (display.mime !== undefined) requiredString(display.mime, `${label}[${index}].mime`, 160);
    if (display.size !== undefined) nonNegativeInteger(display.size, `${label}[${index}].size`);
  });
}

function assertControlBlocker(value, label, question = false, view = false) {
  const blocker = assertRecord(value, label);
  requiredOpaqueId(blocker.requestId, `${label}.requestId`);
  optionalOpaqueId(blocker.turnId, `${label}.turnId`, { nullable: true });
  optionalOpaqueId(blocker.itemId, `${label}.itemId`, { nullable: true });
  assertRuntimeId(blocker.runtimeId, `${label}.runtimeId`);
  if (view && (blocker.event !== undefined || blocker.questions !== undefined)) throw contractError(label, "must not expose native blocker bodies");
  if (question && !view) assertArray(blocker.questions, `${label}.questions`);
  if (blocker.event !== undefined) assertAgentEventEnvelope(blocker.event);
}

export function assertAgentSessionFrame(value) {
  const frame = assertRecord(value, "Agent session frame");
  if (frame.type === "delta") assertAgentDisplayPatch(frame.displayPatch);
  requiredOpaqueId(frame.subscriptionId, "Agent session frame.subscriptionId");
  requiredOpaqueId(frame.streamId, "Agent session frame.streamId");
  const revision = nonNegativeInteger(frame.revision, "Agent session frame.revision");
  if (frame.type === "resync-required") return value;
  if (frame.type !== "delta") throw contractError("Agent session frame.type", "is not supported");
  const baseRevision = nonNegativeInteger(frame.baseRevision, "Agent session frame.baseRevision");
  if (revision <= baseRevision) throw contractError("Agent session frame.revision", "must advance baseRevision");
  const control = assertAgentSessionControlView(frame.control, "Agent session frame.control");
  if (control.streamId !== frame.streamId || control.revision !== revision) {
    throw contractError("Agent session frame.control", "must match the frame version");
  }
  assertAgentSessionMetadata(frame.session);
  return value;
}

function assertAgentSessionMetadata(value) {
  const session = assertRecord(value, "Agent session");
  requiredOpaqueId(session.id, "Agent session.id");
  assertRuntimeId(session.runtimeId ?? session.provider, "Agent session.runtimeId");
  requiredString(session.workspaceRoot, "Agent session.workspaceRoot", MAX_PATH_LENGTH);
  requiredString(session.title, "Agent session.title", 512);
  return value;
}

function sanitizeAgentSessionsListResponse(value) {
  const response = assertRecord(value, "session list");
  const discovery = assertRecord(response.discovery, "session list.discovery");
  return {
    ...(response.catalogCoverage ? { catalogCoverage: {
      truncated: optionalBoolean(response.catalogCoverage.truncated, "catalog.truncated") === true,
      capacity: nonNegativeInteger(response.catalogCoverage.capacity, "catalog.capacity"),
      retained: nonNegativeInteger(response.catalogCoverage.retained, "catalog.retained"),
    } } : {}),
    ...(response.excludedSessionIds === undefined ? {} : { excludedSessionIds: assertArray(response.excludedSessionIds, "session list.excludedSessionIds").slice(0, 500).map((id) => requiredOpaqueId(id, "excluded session id")) }),
    ...(response.catalogNextCursor === undefined ? {} : { catalogNextCursor: historyCursor(response.catalogNextCursor) }),
    ...(response.sessionListKind === undefined ? {} : { sessionListKind: enumValue(response.sessionListKind, "sessionListKind", ["page"]) }),
    sessions: assertArray(response.sessions, "session list.sessions")
      .slice(0, 1000)
      .map((session, index) => sanitizeAgentSessionListItem(session, `session list.sessions[${index}]`)),
    discovery: {
      runtimeId: optionalRuntimeId(discovery.runtimeId) ?? null,
      status: enumValue(discovery.status, "session list.discovery.status", [
        "not-requested", "unsupported", "partial", "complete", "failed",
      ]),
      nextCursor: historyCursor(discovery.nextCursor),
      scanId: optionalOpaqueId(discovery.scanId, "session list.discovery.scanId", { nullable: true }) ?? null,
      ...(discovery.catalogCommit == null ? {} : { catalogCommit: enumValue(discovery.catalogCommit, "history.catalogCommit", ["pending"]) }),
      ...(discovery.retryable == null ? {} : { retryable: optionalBoolean(discovery.retryable, "history.retryable") }),
      ...(discovery.sourceScopeId == null ? {} : { sourceScopeId: requireHistoryNativeId(discovery.sourceScopeId) }),
      ...(discovery.coverage == null ? {} : { coverage: enumValue(discovery.coverage, "history.coverage", ["complete", "unknown"]) }),
      indexed: nonNegativeInteger(discovery.indexed, "session list.discovery.indexed"),
      warnings: safeWarnings(discovery.warnings, "session list.discovery.warnings"),
    },
    warnings: safeWarnings(response.warnings, "session list.warnings"),
  };
}

function sanitizeAgentSessionOpenResult(value) {
  const result = assertRecord(value, "Agent session open result");
  const status = enumValue(result.status, "Agent session open result.status", ["opened", "failed"]);
  if (status === "opened") {
    return { status, snapshot: assertAgentSessionSnapshot(result.snapshot) };
  }
  const error = assertRecord(result.error, "Agent session open result.error");
  return {
    status,
    error: {
      code: enumValue(error.code, "Agent session open result.error.code", AGENT_SESSION_OPEN_ERROR_CODES),
      message: requiredString(error.message, "Agent session open result.error.message", 1_000),
      retryable: optionalBoolean(error.retryable, "Agent session open result.error.retryable") === true,
    },
  };
}

function sanitizeAgentSessionListItem(value, label) {
  const session = assertRecord(value, label);
  const runtimeId = assertRuntimeId(session.runtimeId ?? session.provider, `${label}.runtimeId`);
  const provider = assertRuntimeId(session.provider ?? runtimeId, `${label}.provider`);
  return compact({
    id: requiredOpaqueId(session.id, `${label}.id`),
    runtimeId,
    runtime: session.runtime == null ? undefined : sanitizeAgentRuntimeDescriptor(session.runtime),
    provider,
    providerSessionId: session.providerSessionId == null ? null : requireHistoryNativeId(session.providerSessionId),
    workspaceRoot: requiredString(session.workspaceRoot, `${label}.workspaceRoot`, MAX_PATH_LENGTH),
    title: requiredString(session.title, `${label}.title`, 512),
    createdAt: isoTimestamp(session.createdAt, `${label}.createdAt`),
    updatedAt: isoTimestamp(session.updatedAt, `${label}.updatedAt`),
    updatedAtKnown: optionalBoolean(session.updatedAtKnown, `${label}.updatedAtKnown`),
    terminalState: enumValue(session.terminalState, `${label}.terminalState`, [
      "idle", "running", "completed", "failed", "interrupted", "provider-exited", "outcome-unknown",
    ]),
    selectedModel: optionalString(session.selectedModel, `${label}.selectedModel`, 512) ?? null,
    selectedEffort: optionalString(session.selectedEffort, `${label}.selectedEffort`, 160) ?? null,
    selectedMode: optionalString(session.selectedMode, `${label}.selectedMode`, 160) ?? null,
    lastSequence: nonNegativeInteger(session.lastSequence, `${label}.lastSequence`),
    archivedAt: session.archivedAt == null ? undefined : isoTimestamp(session.archivedAt, `${label}.archivedAt`),
    partial: optionalBoolean(session.partial, `${label}.partial`),
    origin: session.origin == null
      ? undefined
      : enumValue(session.origin, `${label}.origin`, ["puppyone", "native-discovery"]),
  });
}

function safeWarnings(value, label) {
  return assertArray(value, label).slice(0, 50)
    .map((entry, index) => requiredString(entry, `${label}[${index}]`, 4_000));
}

function isoTimestamp(value, label) {
  const input = requiredString(value, label, 64);
  const milliseconds = Date.parse(input);
  if (!Number.isFinite(milliseconds)) throw contractError(label, "must be an ISO timestamp");
  return new Date(milliseconds).toISOString();
}

function optionalReferences(value, label) {
  if (value === undefined || value === null) return undefined;
  const references = assertArray(value, label);
  if (references.length > MAX_REFERENCE_COUNT) throw contractError(label, `may contain at most ${MAX_REFERENCE_COUNT} entries`);
  return references.map((entry, index) => {
    const reference = assertRecord(entry, `${label}[${index}]`);
    return compact({
      path: requiredString(reference.path, `${label}[${index}].path`, MAX_PATH_LENGTH),
      name: optionalString(reference.name, `${label}[${index}].name`, 512),
    });
  });
}

function commandPreconditions(input) {
  return compact({
    expectedSessionEpoch: optionalOpaqueId(input.expectedSessionEpoch, "expectedSessionEpoch"),
    expectedAdapterGeneration: optionalNonNegativeInteger(input.expectedAdapterGeneration, "expectedAdapterGeneration"),
    expectedRunGeneration: optionalNonNegativeInteger(input.expectedRunGeneration, "expectedRunGeneration"),
  });
}

function optionalNonNegativeInteger(value, label) {
  return value === undefined || value === null ? undefined : nonNegativeInteger(value, label);
}

function optionalDraftReferences(value, label) {
  if (value === undefined || value === null) return undefined;
  const references = assertArray(value, label);
  if (references.length > MAX_REFERENCE_COUNT) throw contractError(label, `may contain at most ${MAX_REFERENCE_COUNT} entries`);
  return references.map((entry, index) => sanitizeDraftReference(entry, `${label}[${index}]`, true));
}

function optionalPromptMentions(value, label) {
  if (value === undefined || value === null) return undefined;
  const mentions = assertArray(value, label);
  if (mentions.length > MAX_REFERENCE_COUNT) throw contractError(label, `may contain at most ${MAX_REFERENCE_COUNT} entries`);
  return mentions.map((entry, index) => {
    const mention = assertRecord(entry, `${label}[${index}]`);
    return {
      referenceId: requiredOpaqueId(mention.referenceId, `${label}[${index}].referenceId`),
      start: nonNegativeInteger(mention.start, `${label}[${index}].start`),
      end: nonNegativeInteger(mention.end, `${label}[${index}].end`),
    };
  });
}

function sanitizeDraftReference(value, label, requireReady) {
  const reference = assertRecord(value, label);
  const kind = enumValue(reference.kind, `${label}.kind`, ["workspace-entry", "staged-attachment"]);
  const status = enumValue(reference.status, `${label}.status`, ["resolving", "ready", "error"]);
  if (requireReady && status !== "ready") throw contractError(`${label}.status`, "must be ready before submission");
  const base = {
    id: requiredOpaqueId(reference.id, `${label}.id`),
    kind,
    displayName: requiredString(reference.displayName, `${label}.displayName`, 512),
    status,
  };
  if (kind === "workspace-entry") {
    const relativePath = normalizeAgentWorkspaceRelativePath(reference.relativePath);
    if (!relativePath) throw contractError(`${label}.relativePath`, "must remain workspace-relative");
    const resourceUri = reference.resourceUri === undefined ? null : requiredString(reference.resourceUri, `${label}.resourceUri`, 16_384);
    const resource = resourceUri ? parseWorkspaceResourceReference(resourceUri) : null;
    if (resource && resource.relativePath !== relativePath) throw contractError(`${label}.resourceUri`, "must match the relative path");
    return {
      ...base,
      entryType: enumValue(reference.entryType, `${label}.entryType`, ["file", "directory"]),
      relativePath,
      ...(resource ? { resourceUri, workspaceFolderId: resource.folderId } : {}),
      ...(reference.workspaceName === undefined ? {} : { workspaceName: requiredString(reference.workspaceName, `${label}.workspaceName`, 512) }),
      ...(reference.mime === undefined ? {} : { mime: requiredString(reference.mime, `${label}.mime`, 160) }),
      ...(reference.size === undefined ? {} : { size: nonNegativeInteger(reference.size, `${label}.size`) }),
    };
  }
  return {
    ...base,
    token: requiredOpaqueId(reference.token, `${label}.token`),
    mime: requiredString(reference.mime, `${label}.mime`, 160),
    size: nonNegativeInteger(reference.size, `${label}.size`),
  };
}

function boundedStringArray(value, label, maximumEntries, maximumLength) {
  const entries = assertArray(value, label);
  if (entries.length === 0 || entries.length > maximumEntries) throw contractError(label, `must contain 1-${maximumEntries} entries`);
  return entries.map((entry, index) => requiredString(entry, `${label}[${index}]`, maximumLength));
}

function boundedOpaqueIdArray(value, label, maximumEntries) {
  const entries = assertArray(value, label);
  if (entries.length > maximumEntries) throw contractError(label, `may contain at most ${maximumEntries} entries`);
  return entries.map((entry, index) => requiredOpaqueId(entry, `${label}[${index}]`));
}

function optionalQuestionAnswer(value, label) {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string") return value === null ? null : boundedAnswer(value, label);
  if (!Array.isArray(value)) throw contractError(label, "must be text, an array, or null");
  if (value.length > 100) throw contractError(label, "contains too many entries");
  return value.map((entry, index) => (
    Array.isArray(entry)
      ? entry.slice(0, 100).map((item, itemIndex) => boundedAnswer(item, `${label}[${index}][${itemIndex}]`))
      : boundedAnswer(entry, `${label}[${index}]`)
  ));
}

function optionalAnswerMatrix(value, label) {
  if (value === undefined || value === null) return value;
  if (!Array.isArray(value) || value.length > 100) throw contractError(label, "must be a bounded array");
  return value.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length > 100) throw contractError(`${label}[${rowIndex}]`, "must be a bounded array");
    return row.map((entry, entryIndex) => boundedAnswer(entry, `${label}[${rowIndex}][${entryIndex}]`));
  });
}

function boundedAnswer(value, label) {
  return requiredString(value, label, 8_192, { allowEmpty: true, preserveWhitespace: true });
}

function requireHistoryNativeId(value) {
  const id = historyNativeId(value);
  if (!id) throw new TypeError("Invalid native History session id.");
  return id;
}
