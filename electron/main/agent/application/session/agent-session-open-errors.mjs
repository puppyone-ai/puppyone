import { redactSecretText } from "../../agent-events.mjs";

export function sessionOpenFailure(code, message, retryable) {
  return { status: "failed", error: { code, message, retryable } };
}

/** Keep provider-specific diagnostics behind one bounded product error contract. */
export function classifySessionOpenFailure(error) {
  const message = redactSecretText(error instanceof Error ? error.message : String(error)).slice(0, 1_000);
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "HISTORY_SOURCE_CHANGED") return sessionOpenFailure("SOURCE_CHANGED", "The Agent history source changed. Restore the original profile or refresh History.", false);
  if (code === "AUTHENTICATION_EXPIRED" || /auth(?:entication)?.{0,24}expired|login.{0,24}expired/iu.test(message)) {
    return sessionOpenFailure("AUTH_EXPIRED", "The Agent login has expired. Reconnect the Agent and try again.", true);
  }
  if (code === "AUTHENTICATION_REQUIRED" || /sign[ -]?in|log[ -]?in|authentication required|not authenticated/iu.test(message)) {
    return sessionOpenFailure("AUTH_REQUIRED", "Sign in to this Agent before opening the saved session.", true);
  }
  if (/timed out|timeout/iu.test(message)) {
    return sessionOpenFailure("RESUME_TIMED_OUT", "Opening the saved Agent session timed out.", true);
  }
  if (/does not support|unsupported.{0,24}(?:resume|load|history)|method not found/iu.test(message)) {
    return sessionOpenFailure("RESUME_UNSUPPORTED", "This Agent cannot restore saved sessions through its current protocol.", false);
  }
  if (/workspace.{0,32}(?:outside|mismatch|different|assigned)/iu.test(message)) {
    return sessionOpenFailure("WORKSPACE_MISMATCH", "This saved session belongs to a different workspace.", false);
  }
  if (/not installed|runtime.{0,24}unavailable|executable.{0,24}(?:missing|unavailable)/iu.test(message)) {
    return sessionOpenFailure("RUNTIME_UNAVAILABLE", "The selected Agent runtime is unavailable on this device.", true);
  }
  return sessionOpenFailure("PROTOCOL_ERROR", message || "The Agent protocol could not restore this session.", true);
}
