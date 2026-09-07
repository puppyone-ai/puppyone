import { stringOrNull, toIsoFromSeconds } from "./codex-native-values.mjs";
import { boundRendererValue, redactSecrets, redactSecretText } from "../../agent-events.mjs";
import { createAgentFileChangeEvidence } from "../../runtime/agent-file-change-evidence.mjs";

export function normalizeCodexNotification(message) {
  const method = message?.method;
  const params = message?.params ?? {};
  const threadId = stringOrNull(params.threadId);
  const turnId = stringOrNull(params.turnId ?? params.turn?.id);
  const item = params.item && typeof params.item === "object" ? params.item : null;
  const itemId = stringOrNull(params.itemId ?? item?.id);
  switch (method) {
    case "thread/started": {
      const thread = params.thread ?? {};
      return [{
        type: "session.started",
        providerSessionId: stringOrNull(thread.id),
        payload: {
          title: thread.name || thread.preview || "Codex session",
          createdAt: toIsoFromSeconds(thread.createdAt),
          updatedAt: toIsoFromSeconds(thread.updatedAt),
        },
      }];
    }
    case "thread/status/changed":
      // Runtime status is lifecycle state, not a diagnostic. The accompanying
      // failed-turn payload carries the actionable message exactly once.
      return [];
    case "turn/started":
      return [{ type: "turn.started", providerSessionId: threadId, turnId, payload: { status: "running" } }];
    case "turn/completed": {
      const status = params.turn?.status;
      const type = status === "interrupted" ? "turn.interrupted" : status === "failed" ? "turn.failed" : "turn.completed";
      const message = params.turn?.error?.message ? formatCodexErrorMessage(params.turn.error.message) : "";
      const terminalEvent = {
        type,
        providerSessionId: threadId,
        turnId,
        payload: {
          status: normalizeTurnStatus(status),
          ...(message ? { message } : {}),
        },
      };
      return status === "failed" && message
        ? [terminalEvent, {
          type: "provider.error",
          providerSessionId: threadId,
          turnId,
          payload: { message, recoverable: true },
        }]
        : [terminalEvent];
    }
    case "item/started":
      return normalizeItemLifecycle(item, "started", threadId, turnId);
    case "item/completed":
      return normalizeItemLifecycle(item, "completed", threadId, turnId);
    case "item/agentMessage/delta":
      return [{ type: "assistant.delta", providerSessionId: threadId, turnId, itemId, payload: { delta: String(params.delta ?? "") } }];
    case "item/reasoning/summaryTextDelta":
      return [{
        type: "reasoning.summary.delta",
        providerSessionId: threadId,
        turnId,
        itemId,
        payload: {
          delta: String(params.delta ?? ""),
          summaryIndex: params.summaryIndex ?? 0,
          updateMode: "append",
        },
      }];
    case "item/reasoning/summaryPartAdded":
      // This is a section boundary, not hidden chain-of-thought content. It is
      // enough to surface the native working state before readable summary text
      // arrives without leaking raw reasoning tokens.
      return [{ type: "reasoning.summary.delta", providerSessionId: threadId, turnId, itemId, payload: { delta: "", summaryIndex: params.summaryIndex ?? 0, boundary: true } }];
    case "turn/plan/updated":
      return [{ type: "plan.updated", providerSessionId: threadId, turnId, payload: { explanation: stringOrNull(params.explanation), steps: normalizePlan(params.plan) } }];
    case "item/plan/delta":
      return [{
        type: "plan.updated",
        providerSessionId: threadId,
        turnId,
        itemId,
        payload: { text: String(params.delta ?? ""), streaming: true, updateMode: "append" },
      }];
    case "item/commandExecution/outputDelta":
      return [{ type: "command.output.delta", providerSessionId: threadId, turnId, itemId, payload: { delta: String(params.delta ?? "") } }];
    case "item/fileChange/outputDelta":
      return [{ type: "tool.progress", providerSessionId: threadId, turnId, itemId, payload: { delta: String(params.delta ?? "") } }];
    case "item/fileChange/patchUpdated":
      return [{ type: "file.change.updated", providerSessionId: threadId, turnId, itemId, payload: { changes: summarizeFileChanges(params.changes) } }];
    case "item/mcpToolCall/progress":
      return [{ type: "tool.progress", providerSessionId: threadId, turnId, itemId, payload: boundRendererValue(redactSecrets(params)) }];
    case "thread/tokenUsage/updated":
      return [{ type: "usage.updated", providerSessionId: threadId, turnId, payload: boundRendererValue(params.tokenUsage ?? {}) }];
    case "error":
      return [{
        type: params.willRetry ? "provider.connection.updated" : "provider.error",
        providerSessionId: threadId,
        turnId,
        payload: params.willRetry
          ? {
            state: "reconnecting",
            message: formatCodexErrorMessage(params.error, "Codex is reconnecting."),
            ...(Number.isSafeInteger(params.attempt) ? { attempt: params.attempt } : {}),
            ...(Number.isSafeInteger(params.maxAttempts) ? { maxAttempts: params.maxAttempts } : {}),
          }
          : { message: formatCodexErrorMessage(params.error, "Codex reported an error."), recoverable: false },
      }];
    case "warning":
      return [{
        type: "provider.connection.updated",
        providerSessionId: threadId,
        turnId,
        payload: { state: "fallback", message: formatProviderWarning(params) },
      }];
    case "configWarning":
      return [{ type: "provider.warning", providerSessionId: threadId, turnId, payload: { message: formatProviderWarning(params) } }];
    case "deprecationNotice":
      // App-server migration diagnostics are for the integration owner. They
      // must never become user-authored or assistant-authored transcript rows.
      return [];
    default:
      return [];
  }
}

export function normalizeItemLifecycle(item, phase, threadId, turnId) {
  if (!item || typeof item !== "object") return [];
  const itemId = stringOrNull(item.id);
  if (item.type === "userMessage") {
    return phase === "completed"
      ? [{
          type: "user.message",
          providerSessionId: threadId,
          turnId,
          itemId,
          payload: { text: readCodexUserMessageText(item), ...(stringOrNull(item.clientId) ? { clientUserMessageId: item.clientId } : {}) },
        }]
      : [];
  }
  if (item.type === "agentMessage") {
    return phase === "completed"
      ? [{ type: "assistant.completed", providerSessionId: threadId, turnId, itemId, payload: { text: String(item.text ?? "") } }]
      : [];
  }
  if (item.type === "plan") {
    return [{
      type: "plan.updated",
      providerSessionId: threadId,
      turnId,
      itemId,
      payload: {
        text: String(item.text ?? ""),
        completed: phase === "completed",
        updateMode: "replace",
      },
    }];
  }
  if (item.type === "reasoning") {
    return (Array.isArray(item.summary) ? item.summary : []).map((summary, index) => ({
      type: "reasoning.summary.delta",
      providerSessionId: threadId,
      turnId,
      itemId,
      payload: {
        delta: String(summary),
        summaryIndex: index,
        completed: phase === "completed",
        updateMode: "replace",
      },
    }));
  }
  if (item.type === "fileChange") {
    const changes = summarizeFileChanges(item.changes);
    const path = changes.length === 1 ? changes[0]?.path ?? null : null;
    return [
      { type: phase === "started" ? "tool.started" : "tool.completed", providerSessionId: threadId, turnId, itemId, payload: {
        kind: "file-change",
        tool: "edit",
        label: changes.length > 1 ? `Edit ${changes.length} files` : path ? `Edit ${path}` : "Edit files",
        changes,
        input: { changes },
        path,
        status: normalizeToolStatus(item.status, phase),
      } },
      { type: "file.change.updated", providerSessionId: threadId, turnId, itemId, payload: { changes, status: normalizeToolStatus(item.status, phase) } },
    ];
  }
  const tool = summarizeToolItem(item, phase);
  if (tool) return [{ type: phase === "started" ? "tool.started" : "tool.completed", providerSessionId: threadId, turnId, itemId, payload: tool }];
  return phase === "completed" && typeof item.type === "string"
    ? [{
        type: "provider.warning",
        providerSessionId: threadId,
        turnId,
        itemId,
        payload: { message: `Codex returned an unsupported content item (${item.type}).`, recoverable: true },
      }]
    : [];
}

export function readCodexUserMessageText(item) {
  const text = (Array.isArray(item?.content) ? item.content : [])
    .flatMap((content) => content?.type === "text" && typeof content.text === "string" ? [content.text] : [])
    .join("\n");
  return text.slice(0, 128 * 1024);
}

export function summarizeToolItem(item, phase) {
  if (item.type === "commandExecution") {
    return boundRendererValue({
      kind: "command",
      tool: "bash",
      label: item.command || "Command",
      command: item.command || "",
      input: { command: item.command || "", cwd: item.cwd || null },
      cwd: item.cwd || null,
      status: normalizeToolStatus(item.status, phase),
      exitCode: Number.isInteger(item.exitCode) ? item.exitCode : null,
      durationMs: Number.isFinite(item.durationMs) ? item.durationMs : null,
      ...(phase === "completed" && item.aggregatedOutput ? { outputPreview: String(item.aggregatedOutput).slice(-16 * 1024) } : {}),
    });
  }
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
    const result = normalizeCanonicalToolResult(item);
    return boundRendererValue(redactSecrets({
      kind: item.type === "mcpToolCall" ? "mcp" : "tool",
      tool: String(item.tool || (item.type === "mcpToolCall" ? "mcp" : "tool")).trim().toLowerCase(),
      label: item.type === "mcpToolCall" ? `${item.server}.${item.tool}` : item.tool,
      status: normalizeToolStatus(item.status, phase),
      input: item.arguments ?? null,
      durationMs: Number.isFinite(item.durationMs) ? item.durationMs : null,
      ...(result ? { result, outputPreview: canonicalToolResultText(result) } : {}),
    }));
  }
  if (item.type === "webSearch") return { kind: "search", tool: "websearch", label: item.query || "Web search", query: item.query || "", input: { query: item.query || "" }, status: phase === "completed" ? "completed" : "running" };
  if (item.type === "imageView") return { kind: "read", tool: "read", label: `Viewed ${item.path || "image"}`, path: item.path || null, input: { path: item.path || null }, status: phase === "completed" ? "completed" : "running" };
  if (item.type === "contextCompaction") return { kind: "system", tool: "compaction", label: "Compacted context", status: phase === "completed" ? "completed" : "running" };
  return null;
}

export function summarizeFileChanges(changes) {
  if (!Array.isArray(changes)) return [];
  return createAgentFileChangeEvidence(changes.slice(0, 100).map((change) => ({
    path: change?.path,
    kind: typeof change?.kind === "string" ? change.kind : change?.kind?.type || "update",
    diff: change?.diff,
    basis: "native",
  })));
}

export function normalizePlan(plan) {
  if (!Array.isArray(plan)) return [];
  return plan.slice(0, 100).map((entry) => ({
    step: String(entry?.step ?? ""),
    status: ["pending", "inProgress", "completed"].includes(entry?.status) ? entry.status : String(entry?.status ?? "pending"),
  }));
}

export function normalizeTurnStatus(status) {
  if (status === "interrupted") return "interrupted";
  if (status === "failed") return "failed";
  if (status === "inProgress") return "running";
  return "completed";
}

export function normalizeCanonicalToolResult(item) {
  const content = [];
  const append = (entry) => {
    if (typeof entry === "string" && entry) {
      content.push({ type: "text", text: entry });
      return;
    }
    if (!entry || typeof entry !== "object") return;
    if (entry.type === "text" && typeof entry.text === "string") {
      content.push({ type: "text", text: entry.text });
      return;
    }
    if (entry.type === "resource" && entry.resource && typeof entry.resource === "object") {
      content.push({
        type: "artifact",
        uri: typeof entry.resource.uri === "string" ? entry.resource.uri : "",
        mimeType: typeof entry.resource.mimeType === "string" ? entry.resource.mimeType : null,
        text: typeof entry.resource.text === "string" ? entry.resource.text : null,
      });
      return;
    }
    content.push({ type: "json", value: entry });
  };
  const nativeResult = item.result;
  if (Array.isArray(nativeResult?.content)) nativeResult.content.forEach(append);
  else if (nativeResult !== undefined && nativeResult !== null) append(nativeResult);
  if (Array.isArray(item.contentItems)) item.contentItems.forEach(append);
  const error = item.error == null
    ? null
    : typeof item.error === "string"
      ? item.error
      : typeof item.error?.message === "string"
        ? item.error.message
        : JSON.stringify(item.error);
  if (content.length === 0 && !error && item.success === undefined) return null;
  return {
    content,
    error,
    success: typeof item.success === "boolean" ? item.success : null,
    truncated: false,
  };
}

export function canonicalToolResultText(result) {
  const pieces = result.content.flatMap((entry) => {
    if (entry.type === "text") return [entry.text];
    if (entry.type === "artifact" && entry.text) return [entry.text];
    if (entry.type === "json") return [JSON.stringify(entry.value)];
    return [];
  });
  if (result.error) pieces.push(result.error);
  return pieces.join("\n").slice(-16 * 1024);
}

export function normalizeToolStatus(status, phase) {
  if (status === "inProgress" || phase === "started") return "running";
  if (status === "declined") return "declined";
  if (status === "failed") return "failed";
  return "completed";
}

export function formatCodexErrorMessage(value, fallback = "Codex reported an error.") {
  return redactSecretText(extractCodexErrorText(value) || fallback);
}

export function extractCodexErrorText(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try {
        const nested = extractCodexErrorText(JSON.parse(text), depth + 1);
        if (nested) return nested;
      } catch {
        // Keep the bounded provider text when it only resembles JSON.
      }
    }
    return text.slice(0, 32_768);
  }
  if (typeof value !== "object" || Array.isArray(value)) return "";
  return extractCodexErrorText(value.error?.message, depth + 1)
    || extractCodexErrorText(value.message, depth + 1)
    || extractCodexErrorText(value.error, depth + 1);
}

export function formatProviderWarning(params) {
  const summary = typeof params?.message === "string"
    ? params.message
    : typeof params?.summary === "string"
      ? params.summary
      : "Codex warning";
  const details = typeof params?.details === "string" ? params.details : null;
  const warningPath = typeof params?.path === "string" ? params.path : null;
  return redactSecretText([
    summary,
    details,
    warningPath ? `(${warningPath})` : null,
  ].filter(Boolean).join(" "));
}
