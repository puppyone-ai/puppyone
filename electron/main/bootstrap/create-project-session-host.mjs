import { createProjectSessionService } from "../workspace/project-sessions/project-session-service.mjs";

/** Project ownership depends on injected resource ports, never feature internals. */
export function createProjectSessionHost({ agentService, terminalService, getSender, closeProjectServices }) {
  return createProjectSessionService({ getSender, participants: [
    { name: "agent", closeProject: (owner, root) => agentService.closeSessionsForWorkspaceRoot(owner, root) },
    { name: "terminal", closeProject: (owner, root) => terminalService.closeSessionsForWorkspaceRoot(owner, root) },
    { name: "workspace", closeProject: closeProjectServices },
  ] });
}
