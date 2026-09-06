export type AgentEventContentUpdate = Readonly<{
  field: "delta" | "text";
  mode: "append" | "replace";
}>;

export function agentEventContentUpdate(event: {
  type?: string;
  payload?: Record<string, unknown>;
}): AgentEventContentUpdate | null;

export function applyAgentEventContentUpdate(
  current: string,
  event: { type?: string; payload?: Record<string, unknown> },
  limit: number,
): (AgentEventContentUpdate & { text: string; truncated: boolean }) | null;
