import type { AgentOperationFailure } from "../../../../shared/agent-contract/operation-error.mjs";
export type AgentErrorCode =
  | "native-bridge-unavailable"
  | "model-required"
  | "prompt-queue-full"
  | "runtime-exited"
  | "event-gap"
  | "provider-credentials-rejected"
  | "active-turn"
  | "session-prepare-failed"
  | "references-not-ready"
  | "steer-references-unsupported"
  | "unknown";

export type AgentErrorDescriptor = Readonly<{
  code: AgentErrorCode;
  params?: Readonly<Record<string, string | number>>;
  detail?: string;
  operation?: AgentOperationFailure;
}>;

export class AgentOperationError extends Error {
  constructor(readonly failure: AgentOperationFailure) { super(failure.message); this.name = "AgentOperationError"; }
}

export class AgentKnownError extends Error {
  constructor(
    readonly code: Exclude<AgentErrorCode, "unknown">,
    readonly params?: Readonly<Record<string, string | number>>,
  ) {
    super(code);
    this.name = "AgentKnownError";
  }
}

export function createAgentError(
  code: Exclude<AgentErrorCode, "unknown">,
  params?: Readonly<Record<string, string | number>>,
): AgentErrorDescriptor {
  return { code, params };
}

export function formatAgentError(error: unknown): AgentErrorDescriptor {
  if (error instanceof AgentKnownError) return createAgentError(error.code, error.params);
  if (error instanceof AgentOperationError) return { code: "unknown", detail: error.message, operation: error.failure };
  const message = error instanceof Error ? error.message : String(error);
  // Compatibility with older preload builds that cannot yet return a structured bridge error.
  if (message.includes("No handler registered for 'agent:") || message.includes("Desktop Agent bridge unavailable")) {
    return createAgentError("native-bridge-unavailable");
  }
  return { code: "unknown", detail: message.slice(0, 32_768) };
}
