import { boundRendererValue, redactSecrets, redactSecretText } from "../../agent-events.mjs";

const TERMINAL_TOOL_STATUSES = new Set(["completed", "failed"]);

export class AcpEventNormalizer {
  constructor({ turnId = null } = {}) {
    this.turnId = turnId;
    this.messages = new Map();
    this.thoughts = new Set();
    this.tools = new Map();
  }

  reset(turnId) {
    this.turnId = turnId;
    this.messages.clear();
    this.thoughts.clear();
    this.tools.clear();
  }

  normalize(notification) {
    const sessionId = safeId(notification?.sessionId);
    const update = notification?.update;
    if (!update || typeof update !== "object") return [];
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        return this.#messageChunk("assistant", sessionId, update);
      case "agent_thought_chunk":
        return this.#thoughtBoundary(sessionId, update);
      case "user_message_chunk":
        return [];
      case "tool_call":
        return this.#toolUpdate(sessionId, update);
      case "tool_call_update":
        return this.#toolUpdate(sessionId, update);
      case "plan":
        return [event("plan.updated", sessionId, this.turnId, "current-plan", {
          steps: array(update.entries).slice(0, 100).map((entry) => ({
            step: text(entry?.content, 4_000),
            status: normalizePlanStatus(entry?.status),
            priority: text(entry?.priority, 40),
          })).filter((entry) => entry.step),
        })];
      case "usage_update":
        return [event("usage.updated", sessionId, this.turnId, null, boundRendererValue({
          contextWindow: { size: number(update.size), used: number(update.used) },
          ...(update.cost ? { cost: update.cost } : {}),
        }))];
      case "session_info_update":
        return [event("session.updated", sessionId, this.turnId, null, {
          title: text(update.title, 300) || null,
          updatedAt: normalizeDate(update.updatedAt),
        })];
      default:
        return [];
    }
  }

  completeAssistant(sessionId) {
    return Array.from(this.messages.entries()).flatMap(([itemId, state]) => (
      state.role === "assistant" && state.text
        ? [event("assistant.completed", safeId(sessionId), this.turnId, itemId, { text: state.text, ...(state.truncated ? {truncated:true} : {}) })]
        : []
    ));
  }

  #messageChunk(role, sessionId, update) {
    const itemId = safeId(update.messageId) ?? `${role}:${this.turnId ?? "turn"}`;
    const delta = renderContent(update.content, Infinity);
    if (!delta) return [];
    const current = this.messages.get(itemId) ?? { role, text: "" };
    current.truncated = current.truncated || current.text.length + delta.length > 512 * 1024;
    current.text = appendBounded(current.text, delta, 512 * 1024);
    this.messages.set(itemId, current);
    return [event(
      role === "assistant" ? "assistant.delta" : "reasoning.summary.delta",
      sessionId,
      this.turnId,
      itemId,
      { delta },
    )];
  }

  #thoughtBoundary(sessionId, update) {
    const itemId = safeId(update.messageId) ?? `reasoning:${this.turnId ?? "turn"}`;
    if (this.thoughts.has(itemId)) return [];
    this.thoughts.add(itemId);
    // ACP thought chunks may contain hidden chain-of-thought. The UI receives
    // only a working-state boundary, never the private text itself.
    return [event("reasoning.summary.delta", sessionId, this.turnId, itemId, {
      delta: "",
      boundary: true,
      status: "working",
    })];
  }

  #toolUpdate(sessionId, update) {
    const itemId = safeId(update.toolCallId) ?? `acp-tool:${this.tools.size + 1}`;
    const previous = this.tools.get(itemId) ?? {
      started: false,
      output: "",
      status: "pending",
      locations: [],
      changes: [],
      kind: "tool",
      tool: "tool",
      label: "Tool",
      input: {},
    };
    // ACP updates are field-presence patches. Never normalize an already
    // normalized kind, or treat an empty replacement as an omitted field.
    const kind = Object.hasOwn(update, "kind") ? normalizeToolKind(update.kind) : previous.kind;
    const label = Object.hasOwn(update, "title") ? text(update.title, 300) : previous.label;
    const input = update.rawInput === undefined ? previous.input : record(update.rawInput);
    const tool = inferAcpToolName({ kind, label, input, previous: previous.tool });
    const output = Object.hasOwn(update, "content") || Object.hasOwn(update, "rawOutput")
      ? renderToolOutput(update.content, update.rawOutput) : previous.output;
    const status = Object.hasOwn(update, "status") ? text(update.status, 40) : previous.status;
    const locations = Object.hasOwn(update, "locations") ? array(update.locations) : previous.locations;
    const changes = Object.hasOwn(update, "content") ? array(update.content).filter(part => part?.type === "diff").slice(0, 200).map(part => ({
      path: text(part.path, 4_096), kind: "update",
    })).filter(change => change.path) : previous.changes;
    const canonicalStatus = status === "failed" ? "failed" : status === "completed" ? "completed" : status === "pending" ? "pending" : "running";
    const payload = {
      kind, tool, label, status: canonicalStatus, input: boundRendererValue(redactSecrets(input)),
      path: toolPath({ locations }, input),
      command: kind === "command" ? text(input.command, 8_192) || null : null,
      outputPreview: redactSecretText(output).slice(-16 * 1024),
    };
    const result = [];
    if (!TERMINAL_TOOL_STATUSES.has(status)) result.push(event(previous.started ? "tool.progress" : "tool.started", sessionId, this.turnId, itemId, payload));
    if (kind === "command" && output !== previous.output) {
      result.push(event("command.output.delta", sessionId, this.turnId, itemId, {
        delta: redactSecretText(output), updateMode: "replace",
      }));
    }
    if (changes.length || previous.changes.length) {
      result.push(event("file.change.updated", sessionId, this.turnId, itemId, {
        status: canonicalStatus, changes,
      }));
    }
    if (TERMINAL_TOOL_STATUSES.has(status)) result.push(event("tool.completed", sessionId, this.turnId, itemId, payload));
    this.tools.set(itemId, {
      started: true,
      status, locations, changes,
      output,
      kind,
      tool,
      label,
      input,
    });
    return result;
  }
}

export function normalizeAcpPromptUsage(value) {
  if (!value || typeof value !== "object") return null;
  return boundRendererValue({
    inputTokens: number(value.inputTokens),
    outputTokens: number(value.outputTokens),
    totalTokens: number(value.totalTokens),
    cachedReadTokens: number(value.cachedReadTokens),
    cachedWriteTokens: number(value.cachedWriteTokens),
    thoughtTokens: number(value.thoughtTokens),
  });
}

function event(type, providerSessionId, turnId, itemId, payload) {
  return { type, providerSessionId, turnId: safeId(turnId), itemId: safeId(itemId), payload: payload ?? {} };
}

function renderContent(content, limit = 128 * 1024) {
  if (!content || typeof content !== "object") return "";
  if (content.type === "text") return text(content.text, limit);
  if (content.type === "resource" && typeof content.resource?.text === "string") return text(content.resource.text, limit);
  if (content.type === "resource_link") return text(content.title || content.name || content.uri, 4_096);
  if (content.type === "image") return content.uri ? `[image: ${text(content.uri, 4_096)}]` : `[image: ${text(content.mimeType, 160)}]`;
  if (content.type === "audio") return `[audio: ${text(content.mimeType, 160)}]`;
  return "";
}

function renderToolOutput(content, rawOutput) {
  const rendered = array(content).map((part) => {
    if (part?.type === "content") return renderContent(part.content);
    if (part?.type === "diff") return `Diff: ${text(part.path, 4_096)}`;
    if (part?.type === "terminal") return `Terminal: ${text(part.terminalId, 512)}`;
    return "";
  }).filter(Boolean).join("\n\n");
  if (rendered) return rendered;
  if (typeof rawOutput === "string") return rawOutput.slice(0, 256 * 1024);
  if (rawOutput === undefined) return "";
  try {
    return JSON.stringify(rawOutput, null, 2).slice(0, 256 * 1024);
  } catch {
    return "[unserializable tool output]";
  }
}

function normalizeToolKind(value) {
  const kind = text(value, 80).toLowerCase();
  if (kind === "execute") return "command";
  if (["edit", "delete", "move"].includes(kind)) return "file-change";
  if (kind === "read") return "read";
  if (kind === "search") return "search";
  if (kind === "fetch") return "network";
  return "tool";
}

function inferAcpToolName({ kind, label, input, previous }) {
  const title = text(label, 300).trim().toLowerCase();
  const titleToken = title.match(/^([a-z][a-z0-9_-]*)/u)?.[1]?.replace(/[_-]+/g, "") || "";
  for (const tool of ["bash", "shell", "read", "write", "edit", "grep", "glob", "webfetch", "websearch", "skill", "task"]) {
    if (titleToken === tool) {
      return tool === "shell" ? "bash" : tool === "task" ? "agent" : tool;
    }
  }
  if (kind === "command") return "bash";
  if (kind === "read") return "read";
  if (kind === "network") return "webfetch";
  if (kind === "file-change") {
    if (typeof input.oldString === "string" || typeof input.old_string === "string") return "edit";
    if (typeof input.content === "string") return "write";
    return previous && previous !== "tool" ? previous : "edit";
  }
  if (kind === "search") {
    if (/glob|files?/.test(title)) return "glob";
    if (/grep|search|find/.test(title)) return "grep";
    return previous && previous !== "tool" ? previous : "search";
  }
  return previous || "tool";
}

function toolPath(update, input) {
  const location = array(update.locations)[0]?.path;
  return text(location || input.path || input.file_path || input.filePath || input.filepath, 4_096) || null;
}

function normalizePlanStatus(value) {
  return value === "completed" ? "completed" : value === "in_progress" ? "in_progress" : "pending";
}

function normalizeDate(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function appendBounded(current, incoming, limit) {
  const remaining = limit - current.length;
  return remaining > 0 ? `${current}${incoming.slice(0, remaining)}` : current.slice(0, limit);
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/.test(value) ? value : null;
}

function text(value, limit) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : value === undefined ? {} : { value };
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function number(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
}
