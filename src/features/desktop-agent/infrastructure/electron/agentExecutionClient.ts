import type { AgentClientPort } from "../../application/AgentClientPort";
import type { ProjectSessionContext } from "../../../../../shared/project-session-contract/types";
import type { ItemLifecyclePort } from "../../../../../shared/item-host-contract/lifecycle";
import { handOffItemExecution } from "../../../session-transport";

/** Binds a tab to Main's execution scope before any native create/open can yield. */
export function createManagedAgentClient(base: AgentClientPort, management: ItemLifecyclePort,
  projectContext: ProjectSessionContext, itemId: string): AgentClientPort {
  type Execution = { creationId: string; sessionId: string | null; runtimeId: unknown; prepared: boolean };
  let active: Execution | null = null;
  let terminated = false;
  const releasePreparation = async (target: Execution) => {
    await handOffItemExecution(management, { kind: "agent", itemId, creationId: target.creationId,
      operationId: `terminate-${target.creationId}`, projectContext });
    if (active === target) active = null;
  };
  const execute = async (method: "discoverAgentRuntimes" | "createAgentSession" | "openAgentSession" | "resumeAgentSession", request: Record<string, unknown>) => {
    if (terminated) throw new Error("This tab's execution has been terminated.");
    const preparing = method === "discoverAgentRuntimes";
    if (method === "createAgentSession" && active && !active.sessionId && !active.prepared) {
      throw new Error("This tab's execution is already starting.");
    }
    if (active && !active.sessionId && !(method === "createAgentSession" && active.prepared && active.runtimeId === request.runtimeId)) {
      await releasePreparation(active);
      if (terminated) throw new Error("This tab's execution has been terminated.");
    }
    const existing = active;
    const reusingLive = method !== "createAgentSession" && existing?.sessionId && existing.sessionId === request.sessionId;
    const reusingPrepared = method === "createAgentSession" && existing?.prepared && existing.runtimeId === request.runtimeId;
    if (!reusingLive && !reusingPrepared && existing) throw new Error("Close the previous execution before opening another.");
    const target: Execution = (reusingLive || reusingPrepared) && existing ? existing
      : { creationId: crypto.randomUUID(), sessionId: null, runtimeId: request.runtimeId, prepared: false };
    target.prepared = false;
    active = target;
    try {
      const invoke = base[method] as (input: unknown) => Promise<unknown>;
      const result = await invoke({ ...request, itemId, creationId: target.creationId });
      if (terminated || active !== target) throw new Error("The execution ended during startup.");
      if (preparing) {
        if ((result as { readiness?: { status?: string } })?.readiness?.status === "ready") target.prepared = true;
        else await releasePreparation(target);
        return result;
      }
      const value = result as { session?: { id: string }; snapshot?: { session?: { id: string } } } | null;
      target.sessionId = value?.session?.id ?? value?.snapshot?.session?.id ?? null;
      if (!target.sessionId) active = null;
      return result;
    } catch (error) {
      // Failed/unknown create may have acquired resources. Seal that exact scope
      // before allowing an explicit user retry to allocate another execution.
      if (!reusingLive && !terminated && active === target) {
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
    discoverAgentRuntimes: request => request?.prepareSession && request.runtimeId && request.rootPath && !active?.sessionId
      ? execute("discoverAgentRuntimes", request) as ReturnType<AgentClientPort["discoverAgentRuntimes"]>
      : base.discoverAgentRuntimes(request),
    createAgentSession: request => execute("createAgentSession", request) as ReturnType<AgentClientPort["createAgentSession"]>,
    openAgentSession: request => execute("openAgentSession", request) as ReturnType<AgentClientPort["openAgentSession"]>,
    resumeAgentSession: request => execute("resumeAgentSession", request) as ReturnType<AgentClientPort["resumeAgentSession"]>,
    forkAgentSession: async request => {
      const target = active;
      if (terminated || !target) throw new Error("This tab no longer owns a running execution.");
      const result = await base.forkAgentSession(request);
      if (terminated || active !== target) throw new Error("The execution ended while forking its conversation.");
      target.sessionId = result.session.id;
      return result;
    },
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
