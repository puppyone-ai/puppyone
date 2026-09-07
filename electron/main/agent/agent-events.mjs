import {
  AGENT_EVENT_TYPES,
  assertAgentEventEnvelope,
  sanitizeAgentEventPayload,
} from "../../../shared/agent-contract/schema.mjs";
import { agentDisplayLimits } from "../../../shared/agent-contract/display-schema.mjs";

const SECRET_PATTERNS = [
  { pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g, replacement: "[redacted]" },
  { pattern: /\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, replacement: "$1[redacted]" },
  {
    pattern: /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|token|authorization|password|client[_-]?secret|secret[_-]?access[_-]?key|private[_-]?key)(\s*[:=]\s*)[^\s,;]+/gi,
    replacement: "$1$2[redacted]",
  },
  {
    pattern: /\b([A-Z][A-Z0-9_]*(?:_API_KEY|_ACCESS_TOKEN|_REFRESH_TOKEN|_AUTH_TOKEN|_ID_TOKEN|_SESSION_TOKEN|_CLIENT_SECRET|_SECRET_ACCESS_KEY|_PRIVATE_KEY|_PASSWORD|_CREDENTIALS?))(\s*=\s*)[^\s,;]+/g,
    replacement: "$1$2[redacted]",
  },
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, replacement: "[redacted]" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: "[redacted]" },
];

const SECRET_OBJECT_KEYS = new Set([
  "token",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "idtoken",
  "sessiontoken",
  "authorization",
  "password",
  "clientsecret",
  "secretaccesskey",
  "privatekey",
  "secret",
  "credential",
  "credentials",
  "cookie",
  "setcookie",
]);

export function isAgentEventEnvelope(value) {
  try {
    assertAgentEventEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

export function createAgentEventEnvelope({
  sequence,
  sessionId,
  runtimeId,
  providerSessionId = null,
  turnId = null,
  itemId = null,
  type,
  payload = {},
  emittedAt = new Date().toISOString(),
}) {
  const event = {
    schemaVersion: 1,
    sequence,
    sessionId,
    runtimeId,
    // `provider` remains as a compatibility alias for v1 journals and older
    // renderer projections. New code should use runtimeId.
    provider: runtimeId,
    providerSessionId,
    turnId,
    itemId,
    emittedAt,
    type,
    payload: normalizeDisplayPayload(type, payload),
  };
  if (!isAgentEventEnvelope(event)) {
    throw new TypeError(`Invalid normalized AgentEvent: ${String(type)}`);
  }
  return event;
}

function normalizeDisplayPayload(type, payload) {
  const field = type === "assistant.completed" ? "text" : type === "assistant.delta" ? "delta" : null;
  if (!field || typeof payload[field] !== "string") return sanitizeAgentEventPayload(type, redactSecrets(boundRendererValue(payload)));
  const { [field]: content, ...metadata } = payload;
  const text = redactSecretText(content);
  // Text completeness is explicit. A generic metadata preview must never
  // silently become an authoritative replacement for an accumulated answer.
  return sanitizeAgentEventPayload(type, {
    ...redactSecrets(boundRendererValue(metadata)),
    [field]: text.slice(0, agentDisplayLimits.maxText),
    ...(payload.truncated === true || text.length > agentDisplayLimits.maxText ? { truncated: true } : {}),
  });
}

export function redactSecrets(value, depth = 0) {
  if (depth > 12) return "[truncated]";
  if (typeof value === "string") return redactSecretText(value);
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, depth + 1));
  if (!value || typeof value !== "object") return value;

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey(key)) continue;
    if (isSecretObjectKey(key)) {
      next[key] = "[redacted]";
    } else {
      next[key] = redactSecrets(entry, depth + 1);
    }
  }
  return next;
}

function isSecretObjectKey(key) {
  const normalized = String(key).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return SECRET_OBJECT_KEYS.has(normalized);
}

export function redactSecretText(value) {
  let output = String(value);
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function boundRendererValue(value, maxStringLength = 32 * 1024, depth = 0) {
  const state = {
    remainingText: agentRendererValueLimits.maxTotalText,
    remainingNodes: agentRendererValueLimits.maxNodes,
    seen: new WeakSet(),
  };
  return boundRendererValueWithState(value, maxStringLength, depth, state);
}

function boundRendererValueWithState(value, maxStringLength, depth, state) {
  if (depth > agentRendererValueLimits.maxDepth) return "[truncated]";
  if (state.remainingNodes <= 0) return "[truncated]";
  state.remainingNodes -= 1;
  if (typeof value === "string") {
    const visibleLength = Math.max(0, Math.min(value.length, maxStringLength, state.remainingText));
    state.remainingText -= visibleLength;
    if (visibleLength === value.length) return value;
    return `${value.slice(0, visibleLength)}${visibleLength > 0 ? "\n" : ""}… output truncated`;
  }
  if (Array.isArray(value)) {
    if (state.seen.has(value)) return "[circular]";
    state.seen.add(value);
    const next = [];
    for (const entry of value.slice(0, agentRendererValueLimits.maxCollectionEntries)) {
      if (state.remainingNodes <= 0 || state.remainingText <= 0) {
        next.push("[truncated]");
        break;
      }
      next.push(boundRendererValueWithState(entry, maxStringLength, depth + 1, state));
    }
    return next;
  }
  if (!value || typeof value !== "object") return value;
  if (state.seen.has(value)) return "[circular]";
  state.seen.add(value);
  const next = {};
  for (const [key, entry] of Object.entries(value).slice(0, agentRendererValueLimits.maxCollectionEntries)) {
    if (isUnsafeObjectKey(key)) continue;
    if (state.remainingNodes <= 0 || state.remainingText <= 0) {
      next["…"] = "[truncated]";
      break;
    }
    next[key] = boundRendererValueWithState(entry, maxStringLength, depth + 1, state);
  }
  return next;
}

export const agentRendererValueLimits = Object.freeze({
  maxDepth: 12,
  maxCollectionEntries: 200,
  maxNodes: 4_096,
  maxTotalText: 256 * 1024,
});

function isUnsafeObjectKey(key) {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

export function countTextBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

export const agentEventTypes = AGENT_EVENT_TYPES;
