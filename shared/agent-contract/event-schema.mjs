import { nativeSessionId } from "./native-session-id.mjs";
import { AGENT_EVENT_TYPES, agentContractLimits } from "./constants.mjs";
import {
  assertRecord,
  assertRuntimeId,
  contractError,
  enumValue,
  isOpaqueId,
  nonNegativeInteger,
  optionalOpaqueId,
  positiveInteger,
  requiredString,
} from "./validation.mjs";
import { normalizeAgentWorkspaceRelativePath } from "./reference-identity.mjs";

const EVENT_TYPE_SET = new Set(AGENT_EVENT_TYPES);
const PAYLOAD_KEYS = Object.freeze({
  "session.started": ["title", "status"],
  "session.resumed": ["title", "status"],
  "session.updated": ["title", "status"],
  "session.closed": ["status"],
  "turn.started": ["prompt", "userMessageId", "submissionId", "status", "referenceDisplays", "promptMentions", "model", "effort", "mode", "restored"],
  "turn.completed": ["status", "durationMs", "restored"],
  "turn.failed": ["status", "message", "durationMs", "restored"],
  "turn.interrupted": ["status", "message", "durationMs", "restored"],
  "user.message": ["text", "clientUserMessageId", "userMessageId", "submissionId", "referenceDisplays", "promptMentions", "restored"],
  "assistant.delta": ["delta", "text", "streaming", "updateMode", "truncated", "restored"],
  "assistant.completed": ["text", "streaming", "updateMode", "truncated", "restored"],
  "reasoning.summary.delta": ["delta", "text", "summaryIndex", "completed", "boundary", "updateMode", "truncated", "restored"],
  "plan.updated": ["text", "explanation", "steps", "completed", "streaming", "updateMode", "truncated", "restored"],
  "tool.started": activityPayloadKeys(),
  "tool.progress": activityPayloadKeys(),
  "tool.completed": activityPayloadKeys(),
  "command.output.delta": activityPayloadKeys("delta", "updateMode"),
  "file.change.updated": activityPayloadKeys("changes", "diff", "patch"),
  "usage.updated": ["inputTokens", "outputTokens", "totalTokens", "cachedTokens", "cost", "contextWindow", "tokens"],
  "approval.requested": blockerPayloadKeys("availableDecisions", "commandActions", "networkApprovalContext", "grantRoot", "proposedExecpolicyAmendment", "proposedNetworkPolicyAmendments"),
  "approval.resolved": blockerPayloadKeys("decision", "reason"),
  "question.requested": blockerPayloadKeys("questions"),
  "question.resolved": blockerPayloadKeys("resolution", "rejected", "reason"),
  "provider.activity": activityPayloadKeys(),
  "provider.connection.updated": ["scope", "requestId", "recoveryId", "state", "message", "attempt", "maxAttempts", "maxRetries"],
  "provider.warning": ["code", "stage", "source", "actions", "message", "recoverable", "diagnostic", "attempt", "maxAttempts", "maxRetries"],
  "provider.error": ["code", "stage", "source", "actions", "message", "recoverable", "diagnostic"],
});

export function assertAgentEventEnvelope(value) {
  const event = assertRecord(value, "AgentEvent");
  if (event.schemaVersion !== 1) throw contractError("AgentEvent.schemaVersion", "must equal 1");
  positiveInteger(event.sequence, "AgentEvent.sequence");
  requiredString(event.sessionId, "AgentEvent.sessionId", 256);
  assertRuntimeId(event.runtimeId ?? event.provider, "AgentEvent.runtimeId");
  assertRuntimeId(event.provider, "AgentEvent.provider");
  if (event.providerSessionId != null && !nativeSessionId(event.providerSessionId)) {
    throw contractError("AgentEvent.providerSessionId", "is invalid");
  }
  optionalOpaqueId(event.turnId, "AgentEvent.turnId", { nullable: true });
  optionalOpaqueId(event.itemId, "AgentEvent.itemId", { nullable: true });
  requiredString(event.emittedAt, "AgentEvent.emittedAt", 64);
  if (!EVENT_TYPE_SET.has(event.type)) throw contractError("AgentEvent.type", "is not supported");
  const payload = assertRecord(event.payload, "AgentEvent.payload");
  if (payload.updateMode !== undefined) enumValue(payload.updateMode, "AgentEvent.payload.updateMode", ["append", "replace"]);
  if (payload.truncated !== undefined && typeof payload.truncated !== "boolean") throw contractError("AgentEvent.payload.truncated", "must be boolean");
  if ((event.type === "approval.requested" || event.type === "approval.resolved" || event.type === "question.requested" || event.type === "question.resolved") && !isOpaqueId(payload.requestId)) {
    throw contractError(`AgentEvent(${event.type}).payload.requestId`, "is required");
  }
  if (event.type === "question.requested" && !Array.isArray(payload.questions)) {
    throw contractError("AgentEvent(question.requested).payload.questions", "must be an array");
  }
  for (const key of ["clientUserMessageId", "userMessageId", "submissionId", "requestId", "recoveryId"]) {
    if (payload[key] !== undefined) optionalOpaqueId(payload[key], `AgentEvent.payload.${key}`);
  }
  if (event.type === "user.message") {
    requiredString(payload.text, "AgentEvent(user.message).payload.text", agentContractLimits.maxMessageLength, {
      allowEmpty: true,
      preserveWhitespace: true,
    });
  }
  if (event.type === "turn.started" && payload.userMessageId !== undefined) {
    optionalOpaqueId(payload.userMessageId, "AgentEvent(turn.started).payload.userMessageId");
  }
  if ((event.type === "turn.started" || event.type === "user.message") && payload.referenceDisplays !== undefined) {
    assertReferenceDisplays(payload.referenceDisplays, event.type);
  }
  if ((event.type === "turn.started" || event.type === "user.message") && payload.promptMentions !== undefined) {
    assertPromptMentions(payload.promptMentions, event.type === "user.message" ? payload.text : payload.prompt, event.type);
  }
  if (event.type === "provider.connection.updated") {
    enumValue(payload.state, "AgentEvent(provider.connection.updated).payload.state", ["reconnecting", "fallback", "connected"]);
    for (const key of ["attempt", "maxAttempts", "maxRetries"]) {
      if (payload[key] !== undefined && payload[key] !== null) {
        positiveInteger(payload[key], `AgentEvent(provider.connection.updated).payload.${key}`);
      }
    }
  }
  return value;
}

/** Removes additive native provenance before an envelope crosses Main IPC. */
export function sanitizeAgentEventPayload(type, value) {
  if (!EVENT_TYPE_SET.has(type)) throw contractError("AgentEvent.type", "is not supported");
  const payload = assertRecord(value, `AgentEvent(${type}).payload`);
  return Object.fromEntries(PAYLOAD_KEYS[type]
    .filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
    .map((key) => [key, payload[key]]));
}

export function sanitizeAgentEventEnvelope(value) {
  assertAgentEventEnvelope(value);
  return {
    ...value,
    payload: sanitizeAgentEventPayload(value.type, value.payload),
  };
}

function activityPayloadKeys(...extra) {
  return [
    "kind", "tool", "label", "description", "status", "input", "arguments", "command", "cwd", "path", "query",
    "changes", "outputPreview", "result", "error", "content", "detail", "metadata", "recoverable", "exitCode",
    "duration", "durationMs", "elapsedMs", "diff", "patch", "outputPaths", "truncated", ...extra,
    "restored",
  ];
}

function blockerPayloadKeys(...extra) {
  return ["requestId", "kind", "title", "command", "cwd", "reason", ...extra];
}

function assertPromptMentions(value, prompt, eventType = "turn.started") {
  if (!Array.isArray(value) || value.length > 32) {
    throw contractError(`AgentEvent(${eventType}).payload.promptMentions`, "must contain at most 32 entries");
  }
  const text = typeof prompt === "string" ? prompt : "";
  let boundary = 0;
  value.forEach((entry, index) => {
    const label = `AgentEvent(${eventType}).payload.promptMentions[${index}]`;
    const mention = assertRecord(entry, label);
    if (!isOpaqueId(mention.referenceId)) throw contractError(`${label}.referenceId`, "is invalid");
    const start = nonNegativeInteger(mention.start, `${label}.start`);
    const end = nonNegativeInteger(mention.end, `${label}.end`);
    if (start < boundary || end <= start || end > text.length) throw contractError(label, "has an invalid or overlapping range");
    boundary = end;
  });
}

function assertReferenceDisplays(value, eventType = "turn.started") {
  if (!Array.isArray(value) || value.length > 32) {
    throw contractError(`AgentEvent(${eventType}).payload.referenceDisplays`, "must contain at most 32 entries");
  }
  const allowedKeys = new Set(["id", "kind", "displayName", "relativePath", "workspaceName", "mime", "size"]);
  value.forEach((entry, index) => {
    const label = `AgentEvent(${eventType}).payload.referenceDisplays[${index}]`;
    const reference = assertRecord(entry, label);
    for (const key of Object.keys(reference)) {
      if (!allowedKeys.has(key)) throw contractError(`${label}.${key}`, "is not renderer-safe reference metadata");
    }
    if (!isOpaqueId(reference.id)) throw contractError(`${label}.id`, "is invalid");
    if (!["workspace-file", "workspace-directory", "attachment"].includes(reference.kind)) {
      throw contractError(`${label}.kind`, "is invalid");
    }
    requiredString(reference.displayName, `${label}.displayName`, 512);
    if (reference.workspaceName !== undefined) requiredString(reference.workspaceName, `${label}.workspaceName`, 512);
    if (reference.relativePath !== undefined) {
      const relativePath = requiredString(reference.relativePath, `${label}.relativePath`, 4_096);
      if (!normalizeAgentWorkspaceRelativePath(relativePath)) {
        throw contractError(`${label}.relativePath`, "must remain workspace-relative");
      }
    }
    if (reference.mime !== undefined) requiredString(reference.mime, `${label}.mime`, 200);
    if (reference.size !== undefined) {
      const size = nonNegativeInteger(reference.size, `${label}.size`);
      if (size > 25 * 1024 * 1024) throw contractError(`${label}.size`, "exceeds the reference display limit");
    }
  });
}
