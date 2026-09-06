import { boundRendererValue, redactSecrets, redactSecretText } from "../../agent-events.mjs";

export function createClaudeEventState({ turnId = null, resumed = false } = {}) {
  return {
    turnId,
    resumed,
    lifecycleEmitted: false,
    reasoningStarted: false,
    assistantMessageId: null,
    streamedText: new Set(),
    startedTools: new Set(),
    toolMetadata: new Map(),
    terminal: false,
  };
}

export function normalizeClaudeMessage(message, state = createClaudeEventState()) {
  if (!message || typeof message !== "object") return [];
  const sessionId = safeId(message.session_id);
  const turnId = state.turnId;
  if (message.type === "system" && message.subtype === "init") {
    if (state.lifecycleEmitted) return [];
    state.lifecycleEmitted = true;
    return [event(state.resumed ? "session.resumed" : "session.started", sessionId, turnId, null, {
      title: state.resumed ? "Claude Code session" : "New Claude Code session",
      model: text(message.model),
      permissionMode: text(message.permissionMode),
      version: text(message.claude_code_version),
    })];
  }
  if (message.type === "stream_event") return normalizeStreamEvent(message, state, sessionId);
  if (message.type === "assistant") return normalizeAssistant(message, state, sessionId);
  if (message.type === "user") return normalizeToolResults(message, state, sessionId);
  if (message.type === "tool_progress") {
    const toolId = safeId(message.tool_use_id);
    const metadata = toolId ? state.toolMetadata.get(toolId) : null;
    return [event("tool.progress", sessionId, turnId, safeId(message.tool_use_id), {
      ...toolPayload(message.tool_name || metadata?.name, metadata?.input ?? {}, "running"),
      elapsedMs: Math.max(0, Number(message.elapsed_time_seconds) || 0) * 1_000,
    })];
  }
  if (message.type === "result") return normalizeResult(message, state, sessionId);
  if (message.type === "system" && message.subtype === "api_retry") {
    return [event("provider.connection.updated", sessionId, turnId, null, {
      state: "reconnecting",
      message: redactSecretText(message.error || "Claude Code is retrying the provider request."),
      attempt: Number(message.attempt) || 0,
      maxAttempts: Number(message.max_retries) || 0,
      retryDelayMs: Number(message.retry_delay_ms) || 0,
    })];
  }
  if (message.type === "system" && message.subtype === "permission_denied") {
    return [event("tool.completed", sessionId, turnId, safeId(message.tool_use_id), {
      kind: toolKind(message.tool_name),
      label: toolLabel(message.tool_name, {}),
      status: "declined",
      error: redactSecretText(message.decision_reason || "Permission denied."),
    })];
  }
  if (message.type === "system" && message.subtype === "files_persisted") {
    return [event("file.change.updated", sessionId, turnId, "claude:files", {
      status: message.failed?.length ? "failed" : "completed",
      changes: [...asArray(message.files), ...asArray(message.failed)].slice(0, 200).map((file) => ({
        path: text(file?.filename).slice(0, 4_096),
        status: file?.error ? "failed" : "updated",
      })).filter((change) => change.path),
    })];
  }
  if (message.type === "system" && message.subtype === "local_command_output" && text(message.content)) {
    return [event("assistant.completed", sessionId, turnId, safeId(message.uuid), { text: text(message.content) })];
  }
  if (message.type === "auth_status") {
    return [event(message.error ? "provider.error" : "provider.activity", sessionId, turnId, null, {
      message: redactSecretText(message.error || asArray(message.output).join("\n") || "Claude Code authentication is in progress."),
      status: message.isAuthenticating ? "running" : "completed",
    })];
  }
  return [];
}

export function normalizeClaudeHistory(messages, providerSessionId) {
  const events = [];
  let turnId = null;
  let state = null;
  const finish = () => {
    if (!turnId) return;
    events.push(event("turn.completed", providerSessionId, turnId, null, { status: "completed", restored: true }));
    turnId = null;
    state = null;
  };
  for (const message of asArray(messages)) {
    const content = asArray(message?.message?.content);
    const humanText = message?.type === "user" && !content.some((block) => block?.type === "tool_result")
      ? content.filter((block) => block?.type === "text").map((block) => text(block.text)).join("\n")
      : "";
    if (humanText) {
      finish();
      turnId = `claude:history:${safeId(message.uuid) || events.length + 1}`;
      state = createClaudeEventState({ turnId, resumed: true });
      events.push(event("turn.started", providerSessionId, turnId, null, { status: "running", prompt: humanText, restored: true }));
      continue;
    }
    if (!turnId) {
      turnId = `claude:history:${safeId(message?.uuid) || events.length + 1}`;
      state = createClaudeEventState({ turnId, resumed: true });
      events.push(event("turn.started", providerSessionId, turnId, null, { status: "running", restored: true }));
    }
    events.push(...normalizeClaudeMessage({ ...message, session_id: providerSessionId }, state));
  }
  finish();
  return events;
}

function normalizeStreamEvent(message, state, sessionId) {
  const native = message.event ?? {};
  if (native.type === "message_start") {
    state.assistantMessageId = safeId(native.message?.id) || state.assistantMessageId;
    return [];
  }
  const itemId = assistantSegmentId(state, native.index);
  if (native.type === "content_block_delta" && native.delta?.type === "text_delta") {
    state.streamedText.add(itemId);
    return [event("assistant.delta", sessionId, state.turnId, itemId, { delta: text(native.delta.text) })];
  }
  if (native.type === "content_block_delta" && native.delta?.type === "thinking_delta") {
    if (state.reasoningStarted) return [];
    state.reasoningStarted = true;
    // The native SDK may expose extended-thinking tokens. PuppyOne surfaces a
    // working-state boundary but never republishes hidden chain-of-thought.
    return [event("reasoning.summary.delta", sessionId, state.turnId, itemId, { delta: "", boundary: true })];
  }
  if (native.type === "content_block_start" && native.content_block?.type === "tool_use") {
    return startTool(native.content_block, state, sessionId);
  }
  if (native.type === "message_delta" && native.usage) {
    return [event("usage.updated", sessionId, state.turnId, null, normalizeClaudeUsage(native.usage))];
  }
  return [];
}

function normalizeAssistant(message, state, sessionId) {
  const result = [];
  const messageId = safeId(message.message?.id) || state.assistantMessageId;
  if (messageId) state.assistantMessageId = messageId;
  for (const [index, block] of asArray(message.message?.content).entries()) {
    const itemId = assistantSegmentId(state, index);
    if (block?.type === "text" && text(block.text)) {
      result.push(event("assistant.completed", sessionId, state.turnId, itemId, { text: text(block.text) }));
    } else if (block?.type === "thinking" && text(block.thinking)) {
      if (!state.reasoningStarted) {
        state.reasoningStarted = true;
        result.push(event("reasoning.summary.delta", sessionId, state.turnId, itemId, { delta: "", boundary: true }));
      }
    } else if (block?.type === "tool_use") {
      result.push(...startTool(block, state, sessionId));
    } else if (typeof block?.type === "string") {
      result.push(event("provider.warning", sessionId, state.turnId, itemId, {
        message: `Claude Code returned an unsupported content block (${block.type}).`,
        recoverable: true,
      }));
    }
  }
  if (message.error) {
    result.push(event("provider.error", sessionId, state.turnId, itemId, {
      message: redactSecretText(`Claude Code assistant error: ${message.error}`),
      recoverable: true,
    }));
  }
  return result;
}

function assistantSegmentId(state, index = 0) {
  const messageId = state.assistantMessageId || `claude:assistant:${state.turnId}`;
  const blockIndex = Number.isSafeInteger(index) && index >= 0 ? index : 0;
  return `${messageId}:block:${blockIndex}`;
}

function normalizeClaudeUsage(value) {
  const usage = record(value);
  const inputTokens = nonNegativeNumber(usage.input_tokens ?? usage.inputTokens);
  const outputTokens = nonNegativeNumber(usage.output_tokens ?? usage.outputTokens);
  const cachedTokens = nonNegativeNumber(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens)
    + nonNegativeNumber(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens);
  return boundRendererValue({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cachedTokens });
}

function startTool(block, state, sessionId) {
  const toolId = safeId(block.id) || `claude:tool:${state.startedTools.size + 1}`;
  const previous = state.toolMetadata.get(toolId);
  const name = text(block.name) || previous?.name || "Tool";
  const input = Object.keys(record(block.input)).length > 0 ? record(block.input) : previous?.input ?? {};
  state.toolMetadata.set(toolId, { name, input });
  if (state.startedTools.has(toolId)) {
    return [event("tool.progress", sessionId, state.turnId, toolId, toolPayload(name, input, "running"))];
  }
  state.startedTools.add(toolId);
  return [event("tool.started", sessionId, state.turnId, toolId, toolPayload(name, input, "running"))];
}

function normalizeToolResults(message, state, sessionId) {
  return asArray(message.message?.content).flatMap((block) => {
    if (block?.type !== "tool_result") return [];
    const content = typeof block.content === "string"
      ? [{ type: "text", text: redactSecretText(block.content) }]
      : asArray(block.content).map((part) => part?.type === "text"
        ? { type: "text", text: redactSecretText(text(part.text)) }
        : { type: "json", value: boundRendererValue(redactSecrets(part)) });
    const error = block.is_error ? content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : null;
    const result = { content, error: error || null, success: !block.is_error, truncated: false };
    const output = content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    const toolId = safeId(block.tool_use_id);
    const metadata = toolId ? state.toolMetadata.get(toolId) : null;
    return [event("tool.completed", sessionId, state.turnId, safeId(block.tool_use_id), {
      ...toolPayload(metadata?.name || "Tool", metadata?.input ?? {}, block.is_error ? "failed" : "completed"),
      result,
      outputPreview: redactSecretText(output).slice(-16 * 1024),
    })];
  });
}

function normalizeResult(message, state, sessionId) {
  if (state.terminal) return [];
  state.terminal = true;
  const result = [];
  if (message.usage) {
    result.push(event("usage.updated", sessionId, state.turnId, null, {
      ...normalizeClaudeUsage(message.usage),
      cost: Math.max(0, Number(message.total_cost_usd) || 0),
    }));
  }
  const failed = message.subtype !== "success" || message.is_error === true;
  if (failed) {
    const errorMessage = asArray(message.errors).map(text).filter(Boolean).join("\n") || "Claude Code turn failed.";
    result.push(event("provider.error", sessionId, state.turnId, null, { message: redactSecretText(errorMessage), recoverable: true }));
  }
  result.push(event(failed ? "turn.failed" : "turn.completed", sessionId, state.turnId, null, {
    status: failed ? "failed" : "completed",
    durationMs: Math.max(0, Number(message.duration_ms) || 0),
    stopReason: text(message.stop_reason) || null,
    numTurns: Number(message.num_turns) || 0,
  }));
  return result;
}

function toolPayload(name, input, status) {
  const safeInput = boundRendererValue(redactSecrets(input ?? {}));
  const tool = canonicalToolName(name);
  return {
    kind: toolKind(tool),
    tool,
    label: toolLabel(name, safeInput),
    status,
    input: safeInput,
    path: text(safeInput.file_path || safeInput.path) || null,
    command: text(safeInput.command) || null,
  };
}

function toolKind(name) {
  const normalized = canonicalToolName(name);
  if (normalized === "bash") return "command";
  if (["read", "glob", "grep"].includes(normalized)) return normalized === "read" ? "read" : "search";
  if (["write", "edit"].includes(normalized)) return "file-change";
  if (normalized.includes("web")) return "network";
  return "tool";
}

function toolLabel(name, input) {
  if (canonicalToolName(name) === "bash") return text(input?.description) || text(input?.command).slice(0, 240) || "Run command";
  const path = text(input?.file_path || input?.path);
  return path ? `${name || "Tool"} ${path}` : text(name) || "Tool";
}

function canonicalToolName(name) {
  const normalized = text(name).trim().toLowerCase().replace(/[\s_-]+/g, "");
  const known = {
    bash: "bash",
    shell: "bash",
    read: "read",
    write: "write",
    edit: "edit",
    multiedit: "edit",
    notebookedit: "edit",
    glob: "glob",
    grep: "grep",
    ls: "list",
    webfetch: "webfetch",
    websearch: "websearch",
    todowrite: "todo",
    task: "agent",
    agent: "agent",
    skill: "skill",
    askuserquestion: "question",
  };
  return known[normalized] || normalized || "tool";
}

function event(type, providerSessionId, turnId, itemId, payload) {
  return { type, providerSessionId: safeId(providerSessionId), turnId: safeId(turnId), itemId: safeId(itemId), payload: payload ?? {} };
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/.test(value) ? value : null;
}

function text(value) {
  return typeof value === "string" ? value.slice(0, 32_768) : "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}
