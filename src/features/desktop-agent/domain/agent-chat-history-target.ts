import type { AuxiliaryWorkbenchHistoryTarget } from "../../../lib/workbench/types";
import type { AgentSessionListItem } from "./agent-contract";

export type AgentChatHistoryPayload = Readonly<{
  kind: "agent-session";
  runtimeId: string;
  sessionId: string;
}>;

export function createAgentChatHistoryTarget(
  session: AgentSessionListItem,
): AuxiliaryWorkbenchHistoryTarget {
  const runtimeId = session.runtimeId || session.runtime?.id || "";
  return Object.freeze({
    id: session.id,
    title: session.title,
    iconKey: session.runtime?.iconKey || runtimeId || null,
    payload: Object.freeze({
      kind: "agent-session",
      runtimeId,
      sessionId: session.id,
    } satisfies AgentChatHistoryPayload),
  });
}

export function parseAgentChatHistoryTarget(
  target: AuxiliaryWorkbenchHistoryTarget,
): AgentChatHistoryPayload | null {
  const payload = target.payload;
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Partial<AgentChatHistoryPayload>;
  if (
    candidate.kind !== "agent-session"
    || typeof candidate.runtimeId !== "string"
    || candidate.runtimeId.length === 0
    || typeof candidate.sessionId !== "string"
    || candidate.sessionId.length === 0
  ) return null;
  return Object.freeze({
    kind: "agent-session",
    runtimeId: candidate.runtimeId,
    sessionId: candidate.sessionId,
  });
}
