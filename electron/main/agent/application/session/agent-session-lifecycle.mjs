import { sanitizeAgentOperationError } from "../../runtime/agent-operation-error.mjs";
import { randomUUID } from "node:crypto";
import {
  normalizeOptionalId,
  normalizeOptionalString,
  normalizeRequiredId,
  normalizeRuntimeId,
  requireMatchingWorkspace,
  requireSenderId,
  requireWorkspaceRoot,
} from "../agent-input-policy.mjs";
import {
  applyProviderSession,
  createAgentSessionRecord,
  persistedRecordFromSession,
  sessionMetadata,
  sessionSnapshot,
} from "../../domain/agent-session-model.mjs";
import { resolvePersistedRuntimeId } from "../../migrations/legacy-session-format.mjs";
import { isAgentProviderSessionUnavailableError } from "../../runtime/agent-runtime-port.mjs";
import { resolveAgentSessionHistoryPort } from "../../runtime/agent-session-history-port.mjs";
import {
  classifySessionOpenFailure,
  sessionOpenFailure,
} from "./agent-session-open-errors.mjs";

/** Owns allocation, durable restore, exact History open and shutdown semantics. */
export function createAgentSessionLifecycle({
  runtimeRegistry,
  runtimeResolutionCoordinator,
  sessionStore,
  cache,
  attachmentStore,
  logger,
  runtimeSession,
  emit,
  persistSoon,
}) {
  const sessionCreations = new Set();

  async function createSession(sender, request, workspaceRoot) {
    const ownerId = requireSenderId(sender);
    requireWorkspaceRoot(workspaceRoot);
    sessionStore.discardRetired(ownerId, workspaceRoot);
    const selected = await runtimeSession.resolveRuntimeForOperation(request?.runtimeId, workspaceRoot, "create");
    const session = createAgentSessionRecord({
      id: randomUUID(),
      ownerId,
      sender,
      workspaceRoot,
      runtimeId: selected.descriptor.id,
      runtime: selected.descriptor,
      model: normalizeOptionalString(request?.model),
      effort: normalizeOptionalString(request?.effort),
      mode: normalizeOptionalString(request?.mode),
    });
    sessionStore.add(session);
    try {
      session.adapter = runtimeSession.createAdapterForSession(session, selected.readiness);
      const { inspection, providerSession } = await runtimeSession.bootstrapNativeSession(session, selected, {
        kind: "create",
        operation: "create",
      });
      applyProviderSession(session, providerSession);
      recordRuntimeSuccess(session, selected, inspection);
      if (!session.lifecycleEventSeen) {
        emit(session, {
          type: "session.started",
          providerSessionId: session.providerSessionId,
          payload: sessionMetadata(session),
        });
      }
      persistSoon(session);
      return sessionSnapshot(session);
    } catch (error) {
      recordRuntimeFailure(session);
      await runtimeSession.closeSessionRecord(session, { persist: false });
      throw sanitizeAgentOperationError(error);
    }
  }

  async function resumeSession(sender, request, workspaceRoot) {
    const ownerId = requireSenderId(sender);
    requireWorkspaceRoot(workspaceRoot);
    const connected = sessionStore.findOwned(ownerId, workspaceRoot, { connectedOnly: true });
    const requestedSessionId = normalizeOptionalId(request?.sessionId);
    const requestedLive = requestedSessionId ? sessionStore.get(requestedSessionId) : null;
    if (requestedLive && !requestedLive.providerExited) {
      return sessionSnapshot(runtimeSession.requireOwnedSession(sender, requestedSessionId));
    }
    if (connected && !requestedSessionId) return sessionSnapshot(connected);
    const creationKey = `${ownerId}\0${workspaceRoot}\0resume\0${requestedSessionId || normalizeRuntimeId(request?.runtimeId) || "latest"}`;
    if (sessionCreations.has(creationKey)) throw new Error("An Agent session is already starting for this workspace.");
    sessionCreations.add(creationKey);
    try {
      const retired = sessionStore.takeRetired(ownerId, workspaceRoot, requestedSessionId);
      const persisted = retired
        ? persistedRecordFromSession(retired)
        : requestedSessionId
          ? await cache.findById(requestedSessionId, workspaceRoot)
          : await cache.findLatest(workspaceRoot, normalizeRuntimeId(request?.runtimeId));
      if (!persisted) return null;
      const existing = sessionStore.get(persisted.sessionId);
      if (existing) return sessionSnapshot(runtimeSession.requireOwnedSession(sender, existing.id));
      const runtimeId = resolvePersistedRuntimeId(persisted, normalizeRuntimeId(request?.runtimeId));
      const selected = await runtimeSession.resolveRuntimeForOperation(runtimeId, workspaceRoot, "resume");
      const session = createAgentSessionRecord({
        id: persisted.sessionId,
        ownerId,
        sender,
        workspaceRoot,
        runtimeId,
        runtime: selected.descriptor,
        model: normalizeOptionalString(persisted.selectedModel),
        effort: normalizeOptionalString(persisted.selectedEffort),
        mode: normalizeOptionalString(persisted.selectedMode),
        events: persisted.events,
        sequence: persisted.lastSequence,
        createdAt: persisted.createdAt,
        title: persisted.title,
        terminalState: persisted.terminalState || "idle",
      });
      session.providerSessionId = persisted.providerSessionId;
      sessionStore.add(session);
      try {
        session.adapter = runtimeSession.createAdapterForSession(session, selected.readiness);
        const { inspection, providerSession } = await runtimeSession.bootstrapNativeSession(session, selected, {
          kind: "resume",
          operation: "resume",
          threadId: persisted.providerSessionId,
        });
        applyProviderSession(session, providerSession);
        recordRuntimeSuccess(session, selected, inspection);
        // Resume always reconciles against native objects. The bounded local
        // ledger is a presentation cache and cannot prove that an old active
        // turn has (or has not) reached a native terminal state.
        const history = resolveAgentSessionHistoryPort(session.adapter);
        const historicalEvents = typeof history?.hydrate === "function"
          ? await history.hydrate()
          : [];
        for (const historicalEvent of historicalEvents) emit(session, historicalEvent);
        if (!session.lifecycleEventSeen) {
          emit(session, {
            type: "session.resumed",
            providerSessionId: session.providerSessionId,
            payload: sessionMetadata(session),
          });
        }
        persistSoon(session);
        return sessionSnapshot(session);
      } catch (error) {
        recordRuntimeFailure(session);
        await runtimeSession.closeSessionRecord(session, { persist: false });
        if (isAgentProviderSessionUnavailableError(error)) {
          if (typeof cache.markUnavailable === "function") await cache.markUnavailable(persisted.sessionId);
          else await cache.remove(persisted.sessionId);
          logger.warn?.(`Discarded unavailable ${runtimeId} session metadata; a new native session will be created on demand.`);
          return null;
        }
        throw sanitizeAgentOperationError(error);
      }
    } finally {
      sessionCreations.delete(creationKey);
    }
  }

  async function openSession(sender, request, workspaceRoot) {
    requireWorkspaceRoot(workspaceRoot);
    const sessionId = normalizeRequiredId(request?.sessionId, "Agent session id");
    const runtimeId = normalizeRuntimeId(request?.runtimeId);
    const persisted = await cache.findById(sessionId, workspaceRoot);
    if (
      !persisted
      || persisted.availability !== "available"
      || resolvePersistedRuntimeId(persisted, runtimeId) !== runtimeId
    ) {
      return sessionOpenFailure("SESSION_NOT_FOUND", "This saved Agent session is no longer available.", false);
    }
    try {
      const snapshot = await resumeSession(sender, { sessionId, runtimeId }, workspaceRoot);
      return snapshot
        ? { status: "opened", snapshot }
        : sessionOpenFailure("SESSION_NOT_FOUND", "This saved Agent session is no longer available.", false);
    } catch (error) {
      return classifySessionOpenFailure(error);
    }
  }

  async function closeSession(sender, request, workspaceRoot = null) {
    const session = runtimeSession.requireOwnedSession(sender, request?.sessionId);
    requireMatchingWorkspace(session, workspaceRoot);
    const removePersistence = Boolean(request?.removePersistence);
    await runtimeSession.closeSessionRecord(session, { persist: !removePersistence, removePersistence });
    return { sessionId: session.id, closed: true };
  }

  async function closeSessionsForWindow(webContentsId) {
    await Promise.all(sessionStore.values()
      .filter((session) => session.ownerId === webContentsId)
      .map((session) => runtimeSession.closeSessionRecord(session, { persist: true })));
    await attachmentStore?.revokeOwner?.(webContentsId);
  }

  async function closeSessionsForWorkspaceRoot(webContentsId, workspaceRoot) {
    requireWorkspaceRoot(workspaceRoot);
    const matching = sessionStore.values().filter((session) => (
      session.ownerId === webContentsId && session.workspaceRoot === workspaceRoot
    ));
    await Promise.all(matching.map((session) => runtimeSession.closeSessionRecord(session, { persist: true })));
    await attachmentStore?.revokeWorkspace?.(webContentsId, workspaceRoot);
    return matching.length;
  }

  async function closeAll() {
    await Promise.all(sessionStore.values()
      .map((session) => runtimeSession.closeSessionRecord(session, { persist: true })));
    await attachmentStore?.close?.();
    runtimeResolutionCoordinator.clear();
    await runtimeRegistry.dispose?.();
  }

  function recordRuntimeSuccess(session, selected, inspection) {
    runtimeResolutionCoordinator.recordOperationSuccess({
      runtimeId: session.runtimeId,
      workspaceRoot: session.workspaceRoot,
      readiness: selected.readiness,
      descriptor: selected.descriptor,
      inspection,
    });
  }

  function recordRuntimeFailure(session) {
    runtimeResolutionCoordinator.recordOperationFailure({
      runtimeId: session.runtimeId,
      workspaceRoot: session.workspaceRoot,
    });
  }

  return {
    closeAll,
    closeSession,
    closeSessionsForWindow,
    closeSessionsForWorkspaceRoot,
    createSession,
    getRetainedSessionCount: () => sessionStore.size,
    getSessionCount: () => sessionStore.activeCount(),
    hasRuntimeResources: () => runtimeRegistry.hasActiveResources?.() === true,
    openSession,
    resumeSession,
  };
}
