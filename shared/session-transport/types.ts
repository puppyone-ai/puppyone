import type { ProjectSessionContext } from "../project-session-contract/types";

export type SessionConnection = Readonly<{ connection: string; hostGeneration: string }>;
export type SessionConnectionResult = Readonly<
  | { ok: true; value: SessionConnection }
  | { ok: false; error: { code: string; message: string } }
>;
export type SessionConnectionRequest = Readonly<{
  projectContext: ProjectSessionContext;
  instanceId: string;
}>;

export type AgentConnectionRequest = SessionConnectionRequest & Readonly<{ sessionId: string }>;
export type TerminalConnectionRequest = SessionConnectionRequest & Readonly<{ id: string }>;
export type SessionRuntimeFailure = Readonly<{
  kind: "agent" | "terminal";
  id: string;
  instanceId: string;
  message: string;
  code?: string;
  scope?: "execution" | "display";
}>;
