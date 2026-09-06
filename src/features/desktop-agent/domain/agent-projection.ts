import type { AgentEvent, AgentPromptReferenceMention, AgentReferenceDisplay } from "./agent-contract";
import type {
  AgentActivity,
  AgentProjection,
} from "./agent-projection-types";
import { clearProjectedFileChange, hasRenderableFileChange } from "./agent-file-change-projection";
import {
  activityId,
  defaultToolLabelCode,
  fileChangeLabelCode,
  nullableString,
  pickSafeActivityDetail,
  pickUsage,
  readApprovalDecisions,
  readNetworkApprovalContext,
  readProviderMessage,
  normalizeAgentActivityStatus,
  readQuestions,
  readRecordArray,
  readString,
} from "./agent-projection-readers";
import {
  cloneAgentProjection,
  projectionIndexes,
} from "./agent-projection-indexes";
import {
  isNonDiagnosticProviderStatusMessage,
  legacyProviderConnectionUpdate,
  providerActivityIdentity,
} from "./agent-provider-notice-policy";
import { projectTypedPart } from "./agent-typed-part-projection";
import { reconcileTerminalAgentTurn } from "./agent-turn-lifecycle";
import { agentEventContentUpdate, applyAgentEventContentUpdate } from "../../../../shared/agent-contract/event-content-update.mjs";

export type * from "./agent-projection-types";

const MAX_COMMAND_OUTPUT = 64 * 1024;
const MAX_MESSAGE_TEXT = 128 * 1024;
const MAX_ACTIVITY_TEXT = 64 * 1024;
const ASSISTANT_SEGMENT_BOUNDARY_EVENTS = new Set<AgentEvent["type"]>([
  "user.message",
  "reasoning.summary.delta",
  "plan.updated",
  "tool.started",
  "tool.progress",
  "tool.completed",
  "command.output.delta",
  "file.change.updated",
  "approval.requested",
  "question.requested",
  "provider.activity",
  "provider.warning",
  "provider.error",
]);
const CONNECTION_RECOVERY_PROGRESS_EVENTS = new Set<AgentEvent["type"]>([
  "session.started",
  "session.resumed",
  "session.closed",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "turn.interrupted",
  "user.message",
  "assistant.delta",
  "assistant.completed",
  "reasoning.summary.delta",
  "plan.updated",
  "tool.started",
  "tool.progress",
  "tool.completed",
  "command.output.delta",
  "file.change.updated",
  "usage.updated",
  "approval.requested",
  "question.requested",
  "provider.activity",
  "provider.error",
]);
function readPromptMentions(value: unknown, prompt: string, references: AgentReferenceDisplay[]) {
  if (!Array.isArray(value)) return [];
  const referenceIds = new Set(references.map((reference) => reference.id));
  let boundary = 0;
  return value.flatMap((entry): AgentPromptReferenceMention[] => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    const referenceId = typeof candidate.referenceId === "string" ? candidate.referenceId : "";
    const start = Number.isSafeInteger(candidate.start) ? Number(candidate.start) : -1;
    const end = Number.isSafeInteger(candidate.end) ? Number(candidate.end) : -1;
    if (!referenceIds.has(referenceId) || start < boundary || end <= start || end > prompt.length) return [];
    boundary = end;
    return [{ referenceId, start, end }];
  });
}

export function createAgentProjection(options: { partialHistory?: boolean } = {}): AgentProjection {
  return {
    sessionState: "empty",
    lastSequence: 0,
    partialHistory: Boolean(options.partialHistory),
    missingRanges: [],
    messages: [],
    activities: [],
    approvals: [],
    questions: [],
    turns: [],
    parts: [],
    rows: [],
    connectionStatus: null,
    runningTurnId: null,
    terminalState: null,
    usage: null,
  };
}

export function applyAgentEvents(
  initial: AgentProjection,
  events: AgentEvent[],
  options: AgentProjectionApplyOptions = {},
): AgentProjection {
  const relevant = events
    .filter((event) => event.sequence > initial.lastSequence)
    .sort((left, right) => left.sequence - right.sequence);
  if (relevant.length === 0 && !options.partialHistory) return initial;
  const next = cloneAgentProjection(initial);
  if (options.partialHistory) next.partialHistory = true;
  for (const event of relevant) {
    if (event.sequence <= next.lastSequence) continue;
    applyLegacyAgentEvent(next, event, options);
    projectTypedPart(next, event, options);
    reconcileTerminalAgentTurn(next, event);
  }
  return next;
}

export function applyAgentEvent(
  previous: AgentProjection,
  event: AgentEvent,
  options: AgentProjectionApplyOptions = {},
): AgentProjection {
  if (event.sequence <= previous.lastSequence) return previous;
  const next = cloneAgentProjection(previous);
  applyLegacyAgentEvent(next, event, options);
  projectTypedPart(next, event, options);
  reconcileTerminalAgentTurn(next, event);
  return next;
}

type AgentProjectionApplyOptions = {
  partialHistory?: boolean;
  /** Only snapshot hydration may reinterpret pre-V2 retry warnings. */
  legacyProviderConnectionWarnings?: boolean;
};

function applyLegacyAgentEvent(
  next: AgentProjection,
  event: AgentEvent,
  options: AgentProjectionApplyOptions,
): AgentProjection {
  if (event.sequence <= next.lastSequence) return next;
  if (next.lastSequence > 0 && event.sequence > next.lastSequence + 1) {
    next.partialHistory = true;
    next.missingRanges.push({ from: next.lastSequence + 1, to: event.sequence - 1 });
  } else if (next.lastSequence === 0 && event.sequence > 1) {
    next.partialHistory = true;
    next.missingRanges.push({ from: 1, to: event.sequence - 1 });
  }
  next.lastSequence = event.sequence;
  if (ASSISTANT_SEGMENT_BOUNDARY_EVENTS.has(event.type)) {
    sealStreamingAssistantSegments(next, event.turnId);
  }
  if (event.type !== "provider.connection.updated" && CONNECTION_RECOVERY_PROGRESS_EVENTS.has(event.type)) {
    next.connectionStatus = null;
  }

  switch (event.type) {
    case "session.started":
    case "session.resumed":
      next.sessionState = "active";
      return next;
    case "session.closed":
      next.sessionState = "closed";
      next.runningTurnId = null;
      return next;
    case "turn.started": {
      const payload = event.payload;
      next.sessionState = "active";
      next.runningTurnId = event.turnId;
      next.terminalState = null;
      const prompt = readString(payload.prompt).slice(0, MAX_MESSAGE_TEXT);
      const references = readReferenceDisplays(payload.referenceDisplays);
      const promptMentions = readPromptMentions(payload.promptMentions, prompt, references);
      const userMessageId = typeof payload.userMessageId === "string" ? payload.userMessageId : null;
      const indexes = projectionIndexes(next);
      const turnMessages = event.turnId ? indexes.messagesByTurn.get(event.turnId) ?? [] : [];
      if ((prompt || references.length > 0) && !turnMessages.some((index) => next.messages[index]?.role === "user")) {
        const messageIndex = next.messages.length;
        next.messages.push({
          id: `user:${userMessageId ?? event.turnId ?? event.sequence}`,
          role: "user",
          turnId: event.turnId,
          itemId: userMessageId,
          text: prompt,
          references,
          promptMentions,
          streaming: false,
          terminalState: null,
          sequence: event.sequence,
          updatedSequence: event.sequence,
        });
        indexes.messages.set(`user:${userMessageId ?? event.turnId ?? event.sequence}`, messageIndex);
        if (event.turnId) indexes.messagesByTurn.set(event.turnId, [...turnMessages, messageIndex]);
      }
      return next;
    }
    case "turn.completed":
    case "turn.failed":
    case "turn.interrupted": {
      // The typed turn record is updated before the shared terminal reconciler
      // settles every compatibility collection and semantic part exactly once.
      return next;
    }
    case "user.message":
      return upsertUserMessage(next, event);
    case "assistant.delta":
      return upsertAssistant(next, event, readString(event.payload.delta), true, false);
    case "assistant.completed":
      return upsertAssistant(next, event, readString(event.payload.text), false, true);
    case "reasoning.summary.delta": {
      const payload = event.payload;
      const update = agentEventContentUpdate(event);
      return upsertActivity(next, event, {
        kind: "reasoning",
        label: "",
        labelCode: "reasoning-summary",
        status: payload.completed ? "completed" : "running",
        detail: payload,
      }, update ? { detailField: update.field, contentEvent: event } : {});
    }
    case "plan.updated": {
      const payload = event.payload;
      const update = agentEventContentUpdate(event);
      return upsertActivity(next, { ...event, itemId: event.itemId ?? "current-plan" }, {
        kind: "plan",
        label: "",
        labelCode: "plan-updated",
        status: payload.completed ? "completed" : "running",
        detail: payload,
      }, update ? { detailField: update.field, contentEvent: event } : {});
    }
    case "tool.started":
    case "tool.progress":
    case "tool.completed": {
      const payload = event.payload;
      const kind = payload.kind === "command" ? "command" : payload.kind === "file-change" ? "file-change" : "tool";
      return upsertActivity(next, event, {
        kind,
        label: readString(payload.label),
        labelCode: readString(payload.label) ? undefined : defaultToolLabelCode(kind),
        status: normalizeAgentActivityStatus(payload.status, event.type === "tool.completed" ? "completed" : "running"),
        detail: payload,
      });
    }
    case "command.output.delta": {
      const payload = event.payload;
      const id = activityId(event);
      const indexes = projectionIndexes(next);
      const existingIndex = indexes.activities.get(id);
      if (existingIndex === undefined) {
        const activity: AgentActivity = {
          id,
          turnId: event.turnId,
          itemId: event.itemId,
          kind: "command",
          label: "",
          labelCode: "command-output",
          status: "running",
          detail: {},
          output: readString(payload.delta).slice(-MAX_COMMAND_OUTPUT),
          sequence: event.sequence,
          updatedSequence: event.sequence,
        };
        indexes.activities.set(id, next.activities.length);
        next.activities.push(activity);
      } else {
        const activity = next.activities[existingIndex];
        next.activities[existingIndex] = {
          ...activity,
          output: `${activity.output}${readString(payload.delta)}`.slice(-MAX_COMMAND_OUTPUT),
          updatedSequence: event.sequence,
        };
      }
      return next;
    }
    case "file.change.updated": {
      const payload = event.payload;
      if (!hasRenderableFileChange(payload)) {
        clearProjectedFileChange(next, event);
        return next;
      }
      return upsertActivity(next, event, {
        kind: "file-change",
        label: "",
        labelCode: fileChangeLabelCode(payload),
        status: normalizeAgentActivityStatus(payload.status, "running"),
        detail: payload,
      });
    }
    case "usage.updated":
      next.usage = pickUsage(event.payload);
      return next;
    case "approval.requested": {
      const payload = event.payload;
      const requestId = readString(payload.requestId);
      if (!requestId || !event.turnId || next.approvals.some((approval) => approval.requestId === requestId)) return next;
      next.approvals.push({
        requestId,
        turnId: event.turnId,
        itemId: event.itemId,
        kind: payload.kind === "file-change" ? "file-change" : "command",
        title: readString(payload.title),
        titleCode: readString(payload.title) ? undefined : "approval-required",
        command: nullableString(payload.command),
        cwd: nullableString(payload.cwd),
        commandActions: readRecordArray(payload.commandActions),
        networkApprovalContext: readNetworkApprovalContext(payload.networkApprovalContext),
        grantRoot: nullableString(payload.grantRoot),
        policyChangeRequested: Boolean(
          payload.proposedExecpolicyAmendment
          || (Array.isArray(payload.proposedNetworkPolicyAmendments) && payload.proposedNetworkPolicyAmendments.length > 0)
        ),
        reason: nullableString(payload.reason),
        availableDecisions: readApprovalDecisions(payload.availableDecisions),
        sequence: event.sequence,
      });
      return next;
    }
    case "approval.resolved": {
      const payload = event.payload;
      const requestId = readString(payload.requestId);
      next.approvals = next.approvals.filter((approval) => approval.requestId !== requestId);
      return next;
    }
    case "question.requested": {
      const payload = event.payload;
      const requestId = readString(payload.requestId);
      if (!requestId || !event.turnId || next.questions.some((question) => question.requestId === requestId)) return next;
      next.questions.push({
        requestId,
        turnId: event.turnId,
        itemId: event.itemId,
        questions: readQuestions(payload.questions),
        sequence: event.sequence,
      });
      return next;
    }
    case "question.resolved": {
      const payload = event.payload;
      const requestId = readString(payload.requestId);
      next.questions = next.questions.filter((question) => question.requestId !== requestId);
      return next;
    }
    case "session.updated":
      return next;
    case "provider.activity": {
      const payload = event.payload;
      return upsertActivity(next, event, {
        kind: "tool",
        label: readString(payload.label),
        labelCode: readString(payload.label) ? undefined : "agent-activity",
        status: normalizeAgentActivityStatus(payload.status, "running"),
        detail: pickSafeActivityDetail(payload),
      });
    }
    case "provider.connection.updated": {
      const payload = event.payload;
      if (payload.state === "connected") {
        next.connectionStatus = null;
        return next;
      }
      if (payload.state !== "reconnecting" && payload.state !== "fallback") return next;
      next.connectionStatus = {
        state: payload.state,
        message: readProviderMessage(payload.message),
        attempt: readPositiveInteger(payload.attempt),
        maxAttempts: readPositiveInteger(payload.maxAttempts),
        turnId: event.turnId,
        sequence: event.sequence,
      };
      return next;
    }
    case "provider.warning":
    case "provider.error": {
      const payload = event.payload;
      const kind = event.type === "provider.error" ? "error" : "warning";
      const label = readProviderMessage(payload.message);
      const legacyConnection = options.legacyProviderConnectionWarnings
        ? legacyProviderConnectionUpdate(event, label)
        : null;
      if (legacyConnection) {
        next.connectionStatus = {
          ...legacyConnection,
          message: label,
          turnId: event.turnId,
          sequence: event.sequence,
        };
        return next;
      }
      if (label && isNonDiagnosticProviderStatusMessage(label)) return next;
      const identity = providerActivityIdentity(next, event, label || kind);
      const activityIndexes = projectionIndexes(next).activities;
      const existingActivityIndex = activityIndexes.get(identity.id);
      const existingActivity = existingActivityIndex === undefined ? null : next.activities[existingActivityIndex];
      if (existingActivity?.kind === "error" && kind === "warning") return next;
      const activity: AgentActivity = {
        id: identity.id,
        turnId: identity.turnId,
        itemId: event.itemId ?? existingActivity?.itemId ?? null,
        kind,
        label,
        labelCode: label ? undefined : kind === "error" ? "provider-error" : "provider-warning",
        status: kind === "error" ? "failed" : "warning",
        detail: pickSafeActivityDetail(payload),
        output: "",
        sequence: existingActivity?.sequence ?? event.sequence,
        updatedSequence: event.sequence,
      };
      if (existingActivityIndex === undefined) {
        activityIndexes.set(activity.id, next.activities.length);
        next.activities.push(activity);
      } else {
        next.activities[existingActivityIndex] = activity;
      }
      return next;
    }
    default:
      return next;
  }
}

function readPositiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function readReferenceDisplays(value: unknown): AgentReferenceDisplay[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.id !== "string" || !/^[A-Za-z0-9:._-]{1,256}$/.test(candidate.id)) return [];
    if (typeof candidate.displayName !== "string" || candidate.displayName.length === 0) return [];
    const kind = candidate.kind;
    if (kind !== "workspace-file" && kind !== "workspace-directory" && kind !== "attachment") return [];
    return [{
      id: candidate.id,
      kind,
      displayName: candidate.displayName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 512),
      ...(typeof candidate.relativePath === "string" ? { relativePath: candidate.relativePath.slice(0, 4_096) } : {}),
      ...(typeof candidate.mime === "string" ? { mime: candidate.mime.slice(0, 200) } : {}),
      ...(Number.isSafeInteger(candidate.size) && Number(candidate.size) >= 0 ? { size: Number(candidate.size) } : {}),
    }];
  });
}

/**
 * Reconciles native user-message facts with the optimistic prompt materialized
 * by turn.started. Native item identity wins, while the original ledger
 * position and locally-known reference metadata remain stable.
 */
function upsertUserMessage(projection: AgentProjection, event: AgentEvent<"user.message">) {
  const indexes = projectionIndexes(projection);
  const text = readString(event.payload.text).slice(0, MAX_MESSAGE_TEXT);
  const references = readReferenceDisplays(event.payload.referenceDisplays);
  const promptMentions = readPromptMentions(event.payload.promptMentions, text, references);
  const nativeIndex = event.itemId
    ? projection.messages.findIndex((message) => message.role === "user" && message.itemId === event.itemId)
    : -1;
  const syntheticIndex = nativeIndex < 0 && event.turnId
    ? projection.messages.findIndex((message) => (
        message.role === "user"
        && message.turnId === event.turnId
        && message.itemId === null
        && message.id === `user:${event.turnId}`
        && message.text === text
      ))
    : -1;
  const existingIndex = nativeIndex >= 0 ? nativeIndex : syntheticIndex;
  if (existingIndex >= 0) {
    const existing = projection.messages[existingIndex];
    projection.messages[existingIndex] = {
      ...existing,
      itemId: event.itemId ?? existing.itemId,
      // User messages are immutable. When Main already materialized the
      // submitted display prompt, the native echo only confirms identity; it
      // must not replace user-facing text with provider-compiled context.
      text: existing.text,
      references: references.length > 0 ? references : existing.references,
      promptMentions: promptMentions.length > 0 ? promptMentions : existing.promptMentions,
      updatedSequence: event.sequence,
    };
    return projection;
  }

  const id = event.itemId ? `user:${event.itemId}` : `user:event:${event.sequence}`;
  const messageIndex = projection.messages.length;
  projection.messages.push({
    id,
    role: "user",
    turnId: event.turnId,
    itemId: event.itemId,
    text,
    references,
    promptMentions,
    streaming: false,
    terminalState: null,
    sequence: event.sequence,
    updatedSequence: event.sequence,
  });
  indexes.messages.set(id, messageIndex);
  if (event.turnId) {
    indexes.messagesByTurn.set(event.turnId, [
      ...(indexes.messagesByTurn.get(event.turnId) ?? []),
      messageIndex,
    ]);
  }
  return projection;
}

function upsertAssistant(
  projection: AgentProjection,
  event: AgentEvent,
  text: string,
  streaming: boolean,
  authoritative: boolean,
) {
  const indexes = projectionIndexes(projection);
  const nativeIdentity = event.itemId ?? event.turnId ?? String(event.sequence);
  const baseId = `assistant:${nativeIdentity}`;
  const matchingIndexes = projection.messages.flatMap((message, index) => (
    message.role === "assistant"
    && message.turnId === event.turnId
    && (event.itemId ? message.itemId === event.itemId : message.id === baseId)
      ? [index]
      : []
  ));
  const latestIndex = matchingIndexes.at(-1);
  const latest = latestIndex === undefined ? null : projection.messages[latestIndex];
  const boundaryAfterLatest = Boolean(latest && projection.rows.some((row) => (
    row.turnId === event.turnId
    && row.kind !== "assistant"
    && row.kind !== "user"
    && row.kind !== "usage"
    && row.sequence > (latest.updatedSequence ?? latest.sequence)
  )));
  const segmentedText = boundaryAfterLatest
    ? textAfterAssistantBoundary(projection, matchingIndexes, text, authoritative)
    : authoritative && matchingIndexes.length > 1
      ? textForExistingAssistantSegment(projection, matchingIndexes, text)
      : text;
  const createSegment = boundaryAfterLatest && segmentedText.length > 0;
  const id = createSegment ? `${baseId}:segment:${event.sequence}` : baseId;
  const existingIndex = createSegment ? undefined : latestIndex;
  if (existingIndex !== undefined) {
    const existing = projection.messages[existingIndex];
    projection.messages[existingIndex] = {
      ...existing,
      text: authoritative
        ? (boundaryAfterLatest && !createSegment ? existing.text : segmentedText.slice(0, MAX_MESSAGE_TEXT))
        : appendBounded(existing.text, segmentedText, MAX_MESSAGE_TEXT),
      streaming,
      updatedSequence: event.sequence,
    };
  } else {
    const messageIndex = projection.messages.length;
    projection.messages.push({
      id,
      role: "assistant",
      turnId: event.turnId,
      itemId: event.itemId,
      text: segmentedText.slice(0, MAX_MESSAGE_TEXT),
      streaming,
      terminalState: null,
      sequence: event.sequence,
      updatedSequence: event.sequence,
    });
    indexes.messages.set(id, messageIndex);
    if (event.turnId) {
      indexes.messagesByTurn.set(event.turnId, [...(indexes.messagesByTurn.get(event.turnId) ?? []), messageIndex]);
    }
  }
  return projection;
}

function sealStreamingAssistantSegments(projection: AgentProjection, turnId: string | null) {
  if (!turnId) return;
  projection.messages = projection.messages.map((message) => (
    message.role === "assistant" && message.turnId === turnId && message.streaming
      ? { ...message, streaming: false }
      : message
  ));
  projection.parts = projection.parts.map((part) => (
    part.kind === "assistant" && part.turnId === turnId && part.streaming
      ? { ...part, streaming: false }
      : part
  ));
}

function textAfterAssistantBoundary(
  projection: AgentProjection,
  matchingIndexes: number[],
  incoming: string,
  authoritative: boolean,
) {
  if (!authoritative) return incoming;
  const previousText = matchingIndexes.map((index) => projection.messages[index]?.text ?? "").join("");
  if (!incoming || incoming === previousText) return "";
  if (previousText && incoming.startsWith(previousText)) return incoming.slice(previousText.length);
  const latestText = projection.messages[matchingIndexes.at(-1) ?? -1]?.text ?? "";
  if (latestText && incoming.startsWith(latestText)) return incoming.slice(latestText.length);
  return incoming;
}

function textForExistingAssistantSegment(
  projection: AgentProjection,
  matchingIndexes: number[],
  incoming: string,
) {
  const priorSegments = matchingIndexes.slice(0, -1)
    .map((index) => projection.messages[index]?.text ?? "")
    .join("");
  if (priorSegments && incoming.startsWith(priorSegments)) return incoming.slice(priorSegments.length);
  return incoming;
}

function upsertActivity(
  projection: AgentProjection,
  event: AgentEvent,
  value: Pick<AgentActivity, "kind" | "label" | "labelCode" | "status" | "detail">,
  options: { detailField?: string; contentEvent?: AgentEvent } = {},
) {
  const id = activityId(event);
  const indexes = projectionIndexes(projection);
  const existingIndex = indexes.activities.get(id);
  const safeDetail = pickSafeActivityDetail(value.detail);
  if (existingIndex !== undefined) {
    const existing = projection.activities[existingIndex];
    let detail;
    if (options.detailField) {
      const field = options.detailField;
      const mutation = applyAgentEventContentUpdate(
        readString(existing.detail[field]),
        options.contentEvent ?? event,
        MAX_ACTIVITY_TEXT,
      );
      detail = {
        ...existing.detail,
        ...safeDetail,
        [field]: mutation?.text ?? readString(safeDetail[field]).slice(0, MAX_ACTIVITY_TEXT),
      };
      if (mutation?.truncated) detail.truncated = true;
      else if (mutation?.mode === "replace") delete detail.truncated;
    } else {
      detail = { ...existing.detail, ...safeDetail };
    }
    projection.activities[existingIndex] = {
      ...existing,
      label: value.label || existing.label,
      labelCode: value.label ? undefined : value.labelCode ?? existing.labelCode,
      status: value.status,
      detail,
      updatedSequence: event.sequence,
    };
  } else {
    const initialMutation = options.detailField
      ? applyAgentEventContentUpdate("", options.contentEvent ?? event, MAX_ACTIVITY_TEXT)
      : null;
    const detail = initialMutation
      ? {
          ...safeDetail,
          [options.detailField!]: initialMutation.text,
          ...(initialMutation.truncated ? { truncated: true } : {}),
        }
      : safeDetail;
    indexes.activities.set(id, projection.activities.length);
    projection.activities.push({
      id,
      turnId: event.turnId,
      itemId: event.itemId,
      ...value,
      detail,
      output: "",
      sequence: event.sequence,
      updatedSequence: event.sequence,
    });
  }
  return projection;
}

function appendBounded(current: string, incoming: string, limit: number) {
  const remaining = limit - current.length;
  return remaining > 0 ? `${current}${incoming.slice(0, remaining)}` : current.slice(0, limit);
}

export const agentProjectionLimits = Object.freeze({
  maxMessageText: MAX_MESSAGE_TEXT,
  maxCommandOutput: MAX_COMMAND_OUTPUT,
  maxActivityText: MAX_ACTIVITY_TEXT,
});
