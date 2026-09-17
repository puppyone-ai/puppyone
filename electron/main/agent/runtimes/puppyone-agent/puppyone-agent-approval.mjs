import { PUPPYONE_AGENT_APPROVAL_PROTOCOL } from "./puppyone-agent-kernel.mjs";

/** Decode only the private, versioned request emitted by our bundled worker. */
export function parsePuppyOneAgentApprovalRequest(message) {
  if (message?.method !== "confirm" || message.title !== PUPPYONE_AGENT_APPROVAL_PROTOCOL) return null;
  if (typeof message.message !== "string" || message.message.length > 32 * 1024) return null;
  let value;
  try { value = JSON.parse(message.message); } catch { return null; }
  if (!value || value.schema !== PUPPYONE_AGENT_APPROVAL_PROTOCOL) return null;
  const toolName = bounded(value.toolName, 160);
  if (!toolName) return null;
  return {
    itemId: safeId(value.toolCallId),
    title: bounded(value.title, 300) || `Allow ${toolName}`,
    description: bounded(value.description, 2_000),
    reason: bounded(value.reason, 2_000),
    kind: ["command", "file-change", "tool"].includes(value.kind) ? value.kind : "tool",
    toolName,
    command: bounded(value.command, 8_192),
    arguments: record(value.arguments),
    scopeKey: bounded(value.scopeKey, 200),
    allowSession: value.allowSession !== false,
  };
}

function bounded(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/u.test(value) ? value : null;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
