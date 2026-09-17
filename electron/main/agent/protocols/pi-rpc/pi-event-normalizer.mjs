import { boundRendererValue, redactSecrets, redactSecretText } from "../../agent-events.mjs";
import { createAgentFileChangeEvidence } from "../../runtime/agent-file-change-evidence.mjs";

export function createPiEventState({
  turnId = null,
  providerSessionId = null,
  namespace = "pi",
  runtimeLabel = "Pi",
} = {}) {
  return {
    turnId,
    providerSessionId,
    namespace: safeNamespace(namespace),
    runtimeLabel: text(runtimeLabel) || "Pi",
    reasoningBlocks: new Set(),
    tools: new Map(),
    terminal: false,
    failure: null,
    interruptRequested: false,
  };
}

/** Convert Pi's native session event stream into the shared AgentEvent dialect. */
export function normalizePiRpcEvent(message, state = createPiEventState()) {
  if (!message || typeof message !== "object" || state.terminal) return [];
  switch (message.type) {
    case "message_update":
      return normalizeMessageUpdate(message, state);
    case "message_end":
      return normalizeMessageEnd(message.message, state);
    case "tool_execution_start":
      return startTool(message, state);
    case "tool_execution_update":
      return updateTool(message, state);
    case "tool_execution_end":
      return finishTool(message, state);
    case "auto_retry_start":
      return [event("provider.connection.updated", state, null, {
        state: "reconnecting",
        message: `${state.runtimeLabel} is retrying the model request.`,
        attempt: positiveInteger(message.attempt),
        maxAttempts: positiveInteger(message.maxAttempts),
        retryDelayMs: nonNegativeNumber(message.delayMs),
        diagnostic: redactSecretText(text(message.errorMessage)),
      })];
    case "auto_retry_end":
      if (message.success === true) {
        return [event("provider.connection.updated", state, null, { state: "connected" })];
      }
      state.failure = text(message.finalError) || `${state.runtimeLabel} exhausted its automatic retries.`;
      return [event("provider.error", state, null, {
        message: redactSecretText(state.failure),
        recoverable: true,
      })];
    case "compaction_start":
      return [event("provider.activity", state, `${state.namespace}:compaction`, {
        label: "Compacting context",
        status: "running",
        reason: text(message.reason),
      })];
    case "compaction_end":
      if (message.errorMessage) state.failure = text(message.errorMessage);
      return [event("provider.activity", state, `${state.namespace}:compaction`, {
        label: "Compacting context",
        status: message.aborted ? "cancelled" : message.errorMessage ? "failed" : "completed",
        reason: text(message.reason),
      })];
    case "extension_error":
      return [event("provider.warning", state, null, {
        message: redactSecretText(text(message.error) || `A ${state.runtimeLabel} extension failed.`),
        extension: safePathLabel(message.extensionPath),
        recoverable: true,
      })];
    case "agent_end":
      rememberAssistantFailure(message.messages, state);
      return [];
    case "agent_settled":
      return settleTurn(state);
    default:
      return [];
  }
}

export function normalizePiHistory(messages, providerSessionId, options = {}) {
  const namespace = safeNamespace(options.namespace ?? "pi");
  const runtimeLabel = text(options.runtimeLabel) || "Pi";
  const events = [];
  let turnId = null;
  let turnNumber = 0;
  const tools = new Map();
  const finishTurn = () => {
    if (!turnId) return;
    // Snapshot grouping has no native execution-outcome evidence.
    turnId = null;
    tools.clear();
  };
  for (const message of asArray(messages)) {
    if (message?.role === "user") {
      finishTurn();
      turnNumber += 1;
      turnId = `${namespace}:history:${turnNumber}`;
      events.push(event("turn.started", { turnId, providerSessionId, namespace, runtimeLabel }, null, {
        status: "running",
        prompt: messageText(message),
        restored: true,
      }));
      continue;
    }
    if (!turnId) {
      turnNumber += 1;
      turnId = `${namespace}:history:${turnNumber}`;
      events.push(event("turn.started", { turnId, providerSessionId, namespace, runtimeLabel }, null, {
        status: "running",
        restored: true,
      }));
    }
    const state = createPiEventState({ turnId, providerSessionId, namespace, runtimeLabel });
    state.tools = tools;
    if (message?.role === "assistant") {
      events.push(...normalizeMessageEnd(message, state).map(withHistorical));
    } else if (message?.role === "toolResult") {
      const toolCallId = safeId(message.toolCallId) || `${namespace}:history:tool:${events.length + 1}`;
      const metadata = tools.get(toolCallId) ?? { toolName: text(message.toolName) || "tool", args: {} };
      events.push(event("tool.completed", state, toolCallId, {
        ...toolPayload(metadata.toolName, metadata.args, message.isError ? "failed" : "completed"),
        outputPreview: resultText(message).slice(-32 * 1024),
        restored: true,
      }));
    }
  }
  finishTurn();
  return events;
}

function normalizeMessageUpdate(message, state) {
  const update = message.assistantMessageEvent ?? {};
  const index = Number.isSafeInteger(update.contentIndex) ? update.contentIndex : 0;
  const itemId = `${state.namespace}:assistant:${state.turnId || "turn"}:${index}`;
  const result = [];
  if (update.type === "text_delta" && typeof update.delta === "string" && update.delta) {
    result.push(event("assistant.delta", state, itemId, { delta: update.delta }));
  }
  if ((update.type === "thinking_start" || update.type === "thinking_delta") && !state.reasoningBlocks.has(index)) {
    state.reasoningBlocks.add(index);
    // Pi may expose hidden provider reasoning. The shared renderer receives a
    // working boundary, never raw chain-of-thought tokens.
    result.push(event("reasoning.summary.delta", state, `${state.namespace}:reasoning:${state.turnId}:${index}`, {
      delta: "",
      boundary: true,
    }));
  }
  if (["text_end", "thinking_end", "toolcall_end"].includes(update.type) && message.usage) {
    result.push(event("usage.updated", state, null, normalizeUsage(message.usage)));
  }
  return result;
}

function normalizeMessageEnd(message, state) {
  if (!message || message.role !== "assistant") return [];
  const result = [];
  asArray(message.content).forEach((block, index) => {
    if (block?.type === "text" && text(block.text)) {
      result.push(event("assistant.completed", state, `${state.namespace}:assistant:${state.turnId || "turn"}:${index}`, {
        text: block.text,
      }));
    } else if (block?.type === "thinking" && !state.reasoningBlocks.has(index)) {
      state.reasoningBlocks.add(index);
      result.push(event("reasoning.summary.delta", state, `${state.namespace}:reasoning:${state.turnId || "turn"}:${index}`, {
        delta: "",
        boundary: true,
      }));
    } else if (block?.type === "toolCall") {
      result.push(...startTool({
        toolCallId: block.id,
        toolName: block.name,
        args: block.arguments,
      }, state));
    }
  });
  if (message.usage) result.push(event("usage.updated", state, null, normalizeUsage(message.usage)));
  const stopReason = text(message.stopReason).toLowerCase();
  if (message.errorMessage || ["error", "aborted"].includes(stopReason)) {
    state.failure = text(message.errorMessage) || `${state.runtimeLabel} stopped with ${stopReason}.`;
  }
  return result;
}

function startTool(message, state) {
  const toolCallId = safeId(message.toolCallId) || `${state.namespace}:tool:${state.tools.size + 1}`;
  const previous = state.tools.get(toolCallId);
  const toolName = text(message.toolName) || previous?.toolName || "tool";
  const args = Object.keys(record(message.args)).length ? record(message.args) : previous?.args ?? {};
  state.tools.set(toolCallId, { toolName, args, output: previous?.output ?? "" });
  if (previous) {
    return [event("tool.progress", state, toolCallId, toolPayload(toolName, args, "running"))];
  }
  return [event("tool.started", state, toolCallId, toolPayload(toolName, args, "running"))];
}

function updateTool(message, state) {
  const toolCallId = safeId(message.toolCallId);
  if (!toolCallId) return [];
  const previous = state.tools.get(toolCallId) ?? {
    toolName: text(message.toolName) || "tool",
    args: record(message.args),
    output: "",
  };
  const output = resultText(message.partialResult);
  const delta = output.startsWith(previous.output) ? output.slice(previous.output.length) : output;
  state.tools.set(toolCallId, { ...previous, output });
  const result = [event("tool.progress", state, toolCallId, {
    ...toolPayload(previous.toolName, previous.args, "running"),
    outputPreview: output.slice(-32 * 1024),
  })];
  if (canonicalToolName(previous.toolName) === "bash" && delta) {
    result.push(event("command.output.delta", state, toolCallId, { delta: delta.slice(-32 * 1024) }));
  }
  return result;
}

function finishTool(message, state) {
  const toolCallId = safeId(message.toolCallId) || `${state.namespace}:tool:${state.tools.size + 1}`;
  const previous = state.tools.get(toolCallId) ?? {
    toolName: text(message.toolName) || "tool",
    args: record(message.args),
    output: "",
  };
  const output = resultText(message.result);
  state.tools.delete(toolCallId);
  const status = message.isError ? "failed" : "completed";
  const payload = toolPayload(previous.toolName, previous.args, status);
  const path = toolPath(previous.args);
  const nativeDiff = piEditPatch(message.result?.details);
  if (payload.kind === "file-change" && path && nativeDiff !== null) {
    payload.changes = createAgentFileChangeEvidence([{ path, diff: nativeDiff, basis: "native" }]);
  }
  const result = [event("tool.completed", state, toolCallId, {
    ...payload,
    outputPreview: output.slice(-32 * 1024),
  })];
  if (path && ["edit", "write"].includes(canonicalToolName(previous.toolName))) {
    result.push(event("file.change.updated", state, toolCallId, {
      status,
      changes: payload.changes,
    }));
  }
  return result;
}

function settleTurn(state) {
  if (state.terminal) return [];
  state.terminal = true;
  if (state.interruptRequested) {
    return [event("turn.interrupted", state, null, { status: "interrupted" })];
  }
  if (state.failure) {
    return [
      event("provider.error", state, null, { message: redactSecretText(state.failure), recoverable: true }),
      event("turn.failed", state, null, { status: "failed", message: redactSecretText(state.failure) }),
    ];
  }
  return [event("turn.completed", state, null, { status: "completed" })];
}

function rememberAssistantFailure(messages, state) {
  const assistant = asArray(messages).filter((message) => message?.role === "assistant").at(-1);
  if (!assistant) return;
  const stopReason = text(assistant.stopReason).toLowerCase();
  if (assistant.errorMessage || ["error", "aborted"].includes(stopReason)) {
    state.failure = text(assistant.errorMessage) || `${state.runtimeLabel} stopped with ${stopReason}.`;
  }
}

function toolPayload(name, args, status) {
  const safeInput = boundRendererValue(redactSecrets(args ?? {}));
  const tool = canonicalToolName(name);
  return {
    kind: toolKind(tool),
    tool,
    label: toolLabel(name, safeInput),
    status,
    ...(["edit", "write"].includes(tool) ? { changes: createAgentFileChangeEvidence([{
      path: toolPath(args), before: args?.oldText,
      after: tool === "write" ? args?.content : args?.newText,
      ...(tool === "edit" && Array.isArray(args?.edits) ? { fragments: args.edits.slice(0, 101).map(edit => ({ before: edit?.oldText, after: edit?.newText })) } : {}),
      scope: "fragment", basis: "request",
    }]) } : {}),
    input: safeInput,
    path: toolPath(safeInput),
    command: text(safeInput.command) || null,
  };
}

// Pi exposes both a unified patch and a terminal-oriented diff with line-number
// columns. Decode its native display format here, never in the common Renderer.
function piEditPatch(details) {
  if (typeof details?.patch === "string") return details.patch;
  if (typeof details?.diff !== "string") return null;
  if (/^@@(?:\s|$)/mu.test(details.diff)) return details.diff;
  const lines = details.diff.split(/\r?\n/u);
  if (!lines.some(line => /^[+-]\s*\d+ /u.test(line))) return details.diff;
  return lines.map(line => {
    const match = /^([ +\-])\s*\d+ (.*)$/u.exec(line);
    return match ? match[1] + match[2] : /^\s+\.\.\.$/u.test(line) ? "@@" : line;
  }).join("\n");
}

function toolKind(name) {
  if (name === "bash") return "command";
  if (name === "read") return "read";
  if (["find", "grep", "ls"].includes(name)) return "search";
  if (["edit", "write"].includes(name)) return "file-change";
  return "tool";
}

function toolLabel(name, args) {
  const normalized = canonicalToolName(name);
  if (normalized === "bash") return text(args.command).slice(0, 240) || "Run command";
  const filename = toolPath(args);
  return filename ? `${text(name) || "Tool"} ${filename}` : text(name) || "Tool";
}

function canonicalToolName(value) {
  const normalized = text(value).trim().toLowerCase().replace(/[\s_-]+/gu, "");
  const aliases = {
    shell: "bash",
    powershell: "bash",
    multiedit: "edit",
    list: "ls",
    search: "grep",
  };
  return aliases[normalized] || normalized || "tool";
}

function toolPath(value) {
  return text(value?.path || value?.filePath || value?.file_path) || null;
}

function resultText(value) {
  if (typeof value === "string") return redactSecretText(value);
  const content = asArray(value?.content);
  return redactSecretText(content.filter((part) => part?.type === "text").map((part) => text(part.text)).join("\n"));
}

function messageText(message) {
  if (typeof message?.content === "string") return text(message.content);
  return asArray(message?.content).filter((part) => part?.type === "text").map((part) => text(part.text)).join("\n");
}

function normalizeUsage(value) {
  return boundRendererValue({
    inputTokens: nonNegativeNumber(value?.input),
    outputTokens: nonNegativeNumber(value?.output),
    cachedTokens: nonNegativeNumber(value?.cacheRead) + nonNegativeNumber(value?.cacheWrite),
    totalTokens: nonNegativeNumber(value?.totalTokens),
    cost: value?.cost ?? null,
  });
}

function withHistorical(value) {
  return { ...value, payload: { ...value.payload, restored: true } };
}

function event(type, state, itemId, payload) {
  return {
    type,
    providerSessionId: safeId(state.providerSessionId),
    turnId: safeId(state.turnId),
    itemId: safeId(itemId),
    payload: payload ?? {},
  };
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/u.test(value) ? value : null;
}

function safeNamespace(value) {
  return typeof value === "string" && /^[a-z0-9-]{1,80}$/u.test(value) ? value : "pi";
}

function safePathLabel(value) {
  const input = text(value);
  return input.split(/[\\/]/u).filter(Boolean).at(-1) || null;
}

function text(value) {
  return typeof value === "string" ? value.slice(0, 32 * 1024) : "";
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}
