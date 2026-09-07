import { randomUUID } from "node:crypto";
import {
  normalizeOptionalId,
  normalizeRequiredId,
  requireMatchingWorkspace,
  requireWorkspaceRoot,
} from "../agent-input-policy.mjs";
import {
  applyProviderSession,
  createAgentSessionRecord,
  sessionMetadata,
  sessionSnapshot,
} from "../../domain/agent-session-model.mjs";
import { resolveAgentSessionHistoryPort } from "../../runtime/agent-session-history-port.mjs";

/** Owns explicit session management commands. */
export function createAgentSessionCommands({
  runtimeResolutionCoordinator,
  sessionStore,
  cache,
  runtimeSession,
  emit,
  persistNow,
}) {
  async function forkSession(sender, request, workspaceRoot = null) {
    const source = runtimeSession.requireOwnedSession(sender, request?.sessionId);
    requireMatchingWorkspace(source, workspaceRoot);
    runtimeSession.requireConnectedSession(source);
    if (source.activeTurnId) throw new Error("Stop the active turn before forking this session.");
    if (!source.capabilities?.fork || typeof source.adapter?.forkSession !== "function") {
      throw new Error("The active Agent runtime does not support session forking.");
    }
    const forked = await source.adapter.forkSession({ messageId: normalizeOptionalId(request?.messageId) });
    await persistNow(source);
    await runtimeSession.closeSessionRecord(source, { persist: true });
    const selected = await runtimeSession.resolveRuntimeForOperation(source.runtimeId, source.workspaceRoot, "fork");
    const session = createAgentSessionRecord({
      id: randomUUID(),
      ownerId: source.ownerId,
      sender,
      workspaceRoot: source.workspaceRoot,
      runtimeId: source.runtimeId,
      runtime: source.runtime,
      model: source.selectedModel,
      effort: source.selectedEffort,
      mode: source.selectedMode,
      title: `${source.title} (fork)`,
    });
    sessionStore.add(session);
    try {
      session.adapter = runtimeSession.createAdapterForSession(session, selected.readiness);
      const { inspection, providerSession } = await runtimeSession.bootstrapNativeSession(session, selected, {
        kind: "resume",
        operation: "resume-fork",
        threadId: forked.providerSessionId,
      });
      applyProviderSession(session, providerSession);
      runtimeResolutionCoordinator.recordOperationSuccess({
        runtimeId: session.runtimeId,
        workspaceRoot: session.workspaceRoot,
        readiness: selected.readiness,
        descriptor: selected.descriptor,
        inspection,
      });
      const history = resolveAgentSessionHistoryPort(session.adapter);
      const historicalEvents = typeof history?.hydrate === "function"
        ? await history.hydrate()
        : [];
      for (const historicalEvent of historicalEvents) emit(session, historicalEvent);
      emit(session, {
        type: "session.resumed",
        providerSessionId: session.providerSessionId,
        payload: { ...sessionMetadata(session), forkedFrom: source.id },
      });
      await persistNow(session);
      return sessionSnapshot(session);
    } catch (error) {
      runtimeResolutionCoordinator.recordOperationFailure({
        runtimeId: session.runtimeId,
        workspaceRoot: session.workspaceRoot,
      });
      await runtimeSession.closeSessionRecord(session, { persist: false });
      throw error;
    }
  }

  async function archiveSession(sender, request, workspaceRoot) {
    requireWorkspaceRoot(workspaceRoot);
    const sessionId = normalizeRequiredId(request?.sessionId, "Agent session id");
    const active = sessionStore.get(sessionId);
    if (active) {
      runtimeSession.requireOwnedSession(sender, sessionId);
      requireMatchingWorkspace(active, workspaceRoot);
      if (active.activeTurnId) throw new Error("Stop the active turn before archiving this session.");
      if (request?.archiveNative && typeof active.adapter?.archiveNativeSession === "function") {
        await active.adapter.archiveNativeSession({ threadId: active.providerSessionId });
      }
      await runtimeSession.closeSessionRecord(active, { persist: true });
    } else {
      await requirePersistedSessionInWorkspace(sessionId, workspaceRoot);
    }
    await cache.archive(sessionId, new Date().toISOString());
    return { sessionId, archived: true };
  }

  async function deleteSession(sender, request, workspaceRoot) {
    requireWorkspaceRoot(workspaceRoot);
    const sessionId = normalizeRequiredId(request?.sessionId, "Agent session id");
    const active = sessionStore.get(sessionId);
    if (active) {
      runtimeSession.requireOwnedSession(sender, sessionId);
      requireMatchingWorkspace(active, workspaceRoot);
      if (active.activeTurnId) throw new Error("Stop the active turn before deleting this session.");
      if (request?.deleteNative && typeof active.adapter?.deleteNativeSession === "function") {
        await active.adapter.deleteNativeSession({ threadId: active.providerSessionId });
      }
      await runtimeSession.closeSessionRecord(active, { persist: false });
    } else {
      await requirePersistedSessionInWorkspace(sessionId, workspaceRoot);
    }
    await cache.remove(sessionId);
    return { sessionId, deleted: true, nativeDeleted: Boolean(request?.deleteNative && active) };
  }

  async function compactSession(sender, request, workspaceRoot = null) {
    const session = runtimeSession.requireOwnedSession(sender, request?.sessionId);
    requireMatchingWorkspace(session, workspaceRoot);
    runtimeSession.requireConnectedSession(session);
    if (session.activeTurnId) throw new Error("Stop the active turn before compacting this session.");
    if (!session.capabilities?.compaction || typeof session.adapter?.compactSession !== "function") {
      throw new Error("The active Agent runtime does not support session compaction.");
    }
    await session.adapter.compactSession();
    return { sessionId: session.id, compacted: true };
  }

  async function requirePersistedSessionInWorkspace(sessionId, workspaceRoot) {
    const persisted = await cache.findById(sessionId, workspaceRoot);
    if (!persisted) throw new Error("Agent session was not found in the assigned workspace.");
    return persisted;
  }

  return {
    archiveSession,
    compactSession,
    deleteSession,
    forkSession,
  };
}
