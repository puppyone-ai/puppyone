import { redactSecretText } from "../../agent-events.mjs";

const ERROR_MESSAGE_META_KEY = "codebuddy.ai/errorMessage";
const MAX_MESSAGE_CHARS = 1_000;
const MAX_DIAGNOSTIC_CHARS = 512;

function nonEmptyTrimmed(value, limit) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, limit) : null;
}

function isAuthFailure(category, message, rpcCode) {
  if (typeof category === "string" && category.toLowerCase() === "auth") return true;
  const lower = message.toLowerCase();
  return rpcCode === -32000 && (
    lower.includes("authentication")
    || lower.includes("sign in")
    || lower.includes("/login")
  );
}

function parseErrorEnvelope(raw) {
  let parsed = null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const decoded = JSON.parse(trimmed);
      if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
        parsed = decoded;
      }
    } catch {
      // Plain text error message.
    }
    if (!parsed) {
      const message = redactSecretText(trimmed.slice(0, MAX_MESSAGE_CHARS));
      return {
        errorMessage: message,
        failureCode: isAuthFailure(null, message, null)
          ? "AUTHENTICATION_REQUIRED"
          : "WORKBUDDY_PROMPT_REFUSED",
      };
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    parsed = raw;
  } else {
    return null;
  }

  const data = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
    ? parsed.data
    : null;
  const category = nonEmptyTrimmed(data?.category, 64) ?? nonEmptyTrimmed(parsed.category, 64);
  const rpcCode = Number.isSafeInteger(parsed.code) ? parsed.code : null;
  const httpStatus = Number.isSafeInteger(data?.statusCode) ? data.statusCode : null;
  const bizCode = typeof data?.code === "string" || Number.isSafeInteger(data?.code)
    ? String(data.code).trim()
    : "";
  const message = nonEmptyTrimmed(parsed.message, MAX_MESSAGE_CHARS)
    ?? nonEmptyTrimmed(data?.message, MAX_MESSAGE_CHARS);
  if (!message) return null;

  const redacted = redactSecretText(message);
  const failureCode = isAuthFailure(category, redacted, rpcCode)
    ? "AUTHENTICATION_REQUIRED"
    : "WORKBUDDY_PROMPT_REFUSED";
  const parts = [];
  if (category) parts.push(`category=${category}`);
  if (rpcCode !== null) parts.push(`rpcCode=${rpcCode}`);
  if (httpStatus !== null) parts.push(`httpStatus=${httpStatus}`);
  if (bizCode) parts.push(`bizCode=${bizCode}`);
  const diagnostic = parts.length > 0
    ? redactSecretText(parts.join(", ").slice(0, MAX_DIAGNOSTIC_CHARS))
    : undefined;
  return {
    errorMessage: redacted,
    failureCode,
    ...(diagnostic ? { diagnostic } : {}),
  };
}

/**
 * WorkBuddy reports prompt-level failures (such as unreadable/expired auth)
 * by resolving ACP `session/prompt` with `stopReason: "refusal"` and a
 * serialized error payload in `_meta["codebuddy.ai/errorMessage"]`.
 */
export function createWorkBuddyCompletionInspector() {
  return {
    observe() {},
    complete({ response } = {}) {
      if (!response || typeof response !== "object" || response.stopReason !== "refusal") {
        return null;
      }
      const metaError = response._meta?.[ERROR_MESSAGE_META_KEY];
      const parsed = parseErrorEnvelope(metaError);
      if (parsed) return parsed;
      return { failureCode: "WORKBUDDY_PROMPT_REFUSED" };
    },
  };
}
