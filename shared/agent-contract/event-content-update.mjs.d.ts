export type AgentEventContentUpdate = Readonly<{
  field: "delta" | "text";
  mode: "append" | "replace";
}>;

export function agentEventContentUpdate(event: {
  type?: string;
  payload?: Record<string, unknown>;
}): AgentEventContentUpdate | null;
