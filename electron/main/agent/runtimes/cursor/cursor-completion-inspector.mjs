const HTTP2_CANCEL_CODE = "CURSOR_HTTP2_STREAM_CANCEL";
const MAX_ASSISTANT_TEXT = 8 * 1024;
const MAX_SCAN_NODES = 256;

// Cursor has emitted this failure both as a structured tool result and as the
// entire final assistant message. Keep this exact compatibility signature at
// the provider boundary; generic ACP and Renderer code must not parse prose.
const HTTP2_CANCEL_PATTERN = /^(?:Error:\s*)?(?:RetriableError:\s*)?\[canceled\]\s+http\/2 stream closed with error code CANCEL \(0x8\)\s*$/iu;

export function createCursorCompletionInspector() {
  const assistantMessages = new Map();
  let structuredFailure = null;
  let observedToolActivity = false;

  return {
    observe(notification) {
      const update = notification?.update;
      if (!update || typeof update !== "object") return;
      if (update.sessionUpdate === "agent_message_chunk") {
        const id = safeId(update.messageId) ?? "cursor-assistant";
        const delta = contentText(update.content);
        if (delta) assistantMessages.set(id, appendBounded(assistantMessages.get(id) ?? "", delta));
        return;
      }
      if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") return;
      observedToolActivity = true;
      const failureText = findKnownFailure(update.rawOutput) || findKnownFailure(update.content);
      if (!failureText) return;
      const kind = normalizedText(update.kind).toLowerCase();
      const title = normalizedText(update.title).toLowerCase();
      structuredFailure = degradedCompletion({
        failureScope: kind === "task" || /\b(agent|task)\b/u.test(title) ? "child-task" : "tool",
        sideEffects: "possible",
      });
    },

    complete() {
      if (structuredFailure) return structuredFailure;
      const finalAssistantText = [...assistantMessages.values()].at(-1)?.trim() ?? "";
      if (!HTTP2_CANCEL_PATTERN.test(finalAssistantText)) return null;
      return degradedCompletion({
        failureScope: "upstream-request",
        sideEffects: observedToolActivity ? "possible" : "none",
      });
    },
  };
}

function degradedCompletion({ failureScope, sideEffects }) {
  return {
    completionQuality: "degraded",
    failureScope,
    failureCode: HTTP2_CANCEL_CODE,
    retryable: true,
    transportHealth: "healthy",
    sideEffects,
    diagnostic: "Cursor upstream HTTP/2 stream ended with CANCEL (0x8).",
  };
}

function findKnownFailure(value) {
  const queue = [value];
  const seen = new Set();
  let visited = 0;
  while (queue.length > 0 && visited < MAX_SCAN_NODES) {
    const current = queue.shift();
    visited += 1;
    if (typeof current === "string") {
      const candidate = current.trim();
      if (HTTP2_CANCEL_PATTERN.test(candidate)) return candidate;
      continue;
    }
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current.slice(0, 64));
      continue;
    }
    for (const [key, entry] of Object.entries(current).slice(0, 64)) {
      if (["error", "output", "result", "rawOutput", "content", "text", "providerOptions", "cursor", "highLevelToolCallResult"].includes(key)) {
        queue.push(entry);
      }
    }
  }
  return null;
}

function contentText(content) {
  if (!content || typeof content !== "object") return "";
  return content.type === "text" && typeof content.text === "string" ? content.text : "";
}

function appendBounded(current, incoming) {
  const remaining = MAX_ASSISTANT_TEXT - current.length;
  return remaining > 0 ? `${current}${incoming.slice(0, remaining)}` : current;
}

function normalizedText(value) {
  return typeof value === "string" ? value.slice(0, 300) : "";
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:._-]{1,256}$/u.test(value) ? value : null;
}
