import type { AgentClientPort } from "../../application/AgentClientPort";
import type { ProjectSessionContext } from "../../../../../shared/project-session-contract/types";
import type { ItemLifecyclePort } from "../../../../../shared/item-host-contract/lifecycle";
import { handOffItemExecution } from "../../../session-transport/itemLifecycleClient";

/** Binds a tab to Main's execution scope before any native create/open can yield. */
export function createManagedAgentClient(base: AgentClientPort, management: ItemLifecyclePort,
  projectContext: ProjectSessionContext, itemId: string): AgentClientPort {
  let active: { creationId: string; sessionId: string | null } | null = null;
  let terminated = false;
  const execute = async (method: "createAgentSession" | "openAgentSession" | "resumeAgentSession", request: Record<string, unknown>) => {
    if (terminated) throw new Error("This tab's execution has been terminated.");
    const existing = active;
    const reusing = method !== "createAgentSession" && existing?.sessionId && existing.sessionId === request.sessionId;
    if (!reusing && existing) throw new Error("Close the previous execution before opening another.");
    const target = reusing ? existing : { creationId: crypto.randomUUID(), sessionId: null };
    active = target;
    try {
      const invoke = base[method] as (input: unknown) => Promise<unknown>;
      const result = await invoke({ ...request, itemId, creationId: target.creationId });
      if (terminated || active !== target) throw new Error("The execution ended during startup.");
      const value = result as { session?: { id: string }; snapshot?: { session?: { id: string } } } | null;
      target.sessionId = value?.session?.id ?? value?.snapshot?.session?.id ?? null;
      if (!target.sessionId) active = null;
      return result;
    } catch (error) {
      // Failed/unknown create may have acquired resources. Seal that exact scope
      // before allowing an explicit user retry to allocate another execution.
      if (!terminated && active === target) {
        try {
          await handOffItemExecution(management, { kind: "agent", itemId, creationId: target.creationId,
            operationId: `terminate-${target.creationId}`, projectContext });
          if (active === target) active = null;
        } catch { /* Keep the target available for explicit management retry. */ }
      }
      throw error;
    }
  };
  return {
    ...base,
    createAgentSession: request => execute("createAgentSession", request) as ReturnType<AgentClientPort["createAgentSession"]>,
    openAgentSession: request => execute("openAgentSession", request) as ReturnType<AgentClientPort["openAgentSession"]>,
    resumeAgentSession: request => execute("resumeAgentSession", request) as ReturnType<AgentClientPort["resumeAgentSession"]>,
    closeAgentSession: async request => {
      const result = await base.closeAgentSession(request);
      if (result.closed && active?.sessionId === request.sessionId) active = null;
      return result;
    },
    terminateAgentExecution: async () => {
      terminated = true;
      if (!active) return { kind: "released" };
      return handOffItemExecution(management, { kind: "agent", itemId, creationId: active.creationId,
        operationId: `terminate-${active.creationId}`, projectContext });
    },
  };
}
