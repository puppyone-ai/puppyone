import { createHistoryCatalogPort } from "./history/history-catalog-port.mjs";
import { createAgentHistoryQueries } from "./history/agent-history-queries.mjs";
import { createAgentRuntimeCatalog } from "./agent-runtime-catalog.mjs";
import { createRuntimeResolutionCoordinator } from "./runtime-resolution/runtime-resolution-coordinator.mjs";
import { createAgentEventJournal } from "./agent-event-journal.mjs";
import { createNativeConversationIndexer } from "./history/native-conversation-indexer.mjs";
import { AgentSessionStore } from "./agent-session-store.mjs";
import { createAgentProcessSupervisor } from "./processes/agent-process-supervisor.mjs";
import { createAgentSessionCommands } from "./session/agent-session-commands.mjs";
import { createAgentSessionLifecycle } from "./session/agent-session-lifecycle.mjs";
import { createAgentSessionRuntime } from "./session/agent-session-runtime.mjs";
import { AgentSessionFeed } from "./session/agent-session-feed.mjs";
import { createAgentTurnCoordinator } from "./turn/agent-turn-coordinator.mjs";

/**
 * Provider-neutral Agent application facade.
 *
 * This file is intentionally composition-only: command behavior belongs to
 * focused coordinators, while the returned API remains the stable boundary
 * consumed by Electron IPC.
 */
export function createAgentService({
  runtimeRegistry,
  sessionCache = null,
  conversationCatalog = null,
  persistence: legacyPersistence = null,
  logger = console,
  attachmentStore = null,
  processSupervisor = createAgentProcessSupervisor(),
}) {
  if (!runtimeRegistry || typeof runtimeRegistry.createAdapter !== "function") {
    throw new TypeError("AgentService requires a provider-neutral runtime registry.");
  }
  const cache = sessionCache ?? legacyPersistence;
  if (!cache || typeof cache.save !== "function") {
    throw new TypeError("AgentService requires a session repository.");
  }

  let lifecycle = null;
  const sessionStore = new AgentSessionStore({
    onOwnerDestroyed: (ownerId) => lifecycle?.closeSessionsForWindow(ownerId),
  });
  const runtimeResolutionCoordinator = createRuntimeResolutionCoordinator({
    runtimeRegistry,
    processSupervisor,
  });
  const runtimeCatalog = createAgentRuntimeCatalog({ runtimeResolutionCoordinator });
  const historyCatalog = createHistoryCatalogPort(conversationCatalog ?? cache.historyCatalog);
  const nativeConversationIndexer = createNativeConversationIndexer({
    runtimeRegistry,
    runtimeResolutionCoordinator,
    catalog: historyCatalog,
    processSupervisor,
  });
  const history = createAgentHistoryQueries({ catalog: historyCatalog, nativeConversationIndexer });
  const journal = createAgentEventJournal({ sessionCache: cache, logger });
  const sessionFeed = new AgentSessionFeed({ logger });
  const runtimeSession = createAgentSessionRuntime({
    runtimeRegistry,
    runtimeResolutionCoordinator,
    processSupervisor,
    sessionStore,
    cache,
    attachmentStore,
    logger,
    emit: journal.emit,
    persistNow: journal.persistNow,
  });
  lifecycle = createAgentSessionLifecycle({
    runtimeRegistry,
    runtimeResolutionCoordinator,
    sessionStore,
    cache,
    attachmentStore,
    logger,
    runtimeSession,
    emit: journal.emit,
    persistSoon: journal.persistSoon,
  });
  const turns = createAgentTurnCoordinator({
    runtimeSession,
    emit: journal.emit,
    persistSoon: journal.persistSoon,
    attachmentStore,
  });
  const commands = createAgentSessionCommands({
    runtimeResolutionCoordinator,
    sessionStore,
    cache,
    runtimeSession,
    emit: journal.emit,
    persistNow: journal.persistNow,
  });

  const requireFeedSession = (sender, request, workspaceRoot) => {
    const session = sessionStore.requireOwned(sender, request?.sessionId);
    if (session.workspaceRoot !== workspaceRoot) throw new Error("Agent session workspace does not match the authorized workspace.");
    return session;
  };

  return {
    discoverProviders: (_sender, request = {}, workspaceRoot = null) => runtimeCatalog.discover(request, workspaceRoot),
    listModels: (_sender, request = {}, workspaceRoot = null) => runtimeCatalog.listModels(request, workspaceRoot),
    readAccount: (_sender, request = {}, workspaceRoot = null) => runtimeCatalog.readAccount(request, workspaceRoot),
    getReferenceInputCapabilities: turns.getReferenceInputCapabilities,
    createSession: lifecycle.createSession,
    resumeSession: lifecycle.resumeSession,
    openSession: lifecycle.openSession,
    startTurn: turns.startTurn,
    steerTurn: turns.steerTurn,
    interruptTurn: turns.interruptTurn,
    resolveApproval: turns.resolveApproval,
    resolveQuestion: turns.resolveQuestion,
    replay: turns.replay,
    attachSession: (sender, request, workspaceRoot) => sessionFeed.attach(requireFeedSession(sender, request, workspaceRoot)),
    acknowledgeSession: (sender, request, workspaceRoot) => {
      const session = requireFeedSession(sender, request, workspaceRoot);
      return sessionFeed.acknowledge(session, request);
    },
    readSessionWatermark: (sender, request, workspaceRoot) => {
      const session = requireFeedSession(sender, request, workspaceRoot);
      return sessionFeed.watermark(session, request?.subscriptionId);
    },
    detachSession: (sender, request, workspaceRoot) => {
      const session = requireFeedSession(sender, request, workspaceRoot);
      return sessionFeed.detach(session, request?.subscriptionId);
    },
    listSessions: history.listSessions,
    forkSession: commands.forkSession,
    archiveSession: commands.archiveSession,
    deleteSession: commands.deleteSession,
    compactSession: commands.compactSession,
    closeSession: async (...args) => {
      const sessionId = args[1]?.sessionId;
      const result = await lifecycle.closeSession(...args);
      if (sessionId) sessionFeed.releaseSession(sessionId);
      return result;
    },
    closeSessionsForWindow: async (ownerId) => {
      const sessionIds = sessionStore.values().filter((session) => session.ownerId === ownerId).map((session) => session.id);
      await lifecycle.closeSessionsForWindow(ownerId);
      sessionIds.forEach((sessionId) => sessionFeed.releaseSession(sessionId));
    },
    closeSessionsForWorkspaceRoot: async (ownerId, workspaceRoot) => {
      const sessionIds = sessionStore.values()
        .filter((session) => session.ownerId === ownerId && session.workspaceRoot === workspaceRoot)
        .map((session) => session.id);
      const result = await lifecycle.closeSessionsForWorkspaceRoot(ownerId, workspaceRoot);
      sessionIds.forEach((sessionId) => sessionFeed.releaseSession(sessionId));
      return result;
    },
    closeAll: async () => {
      nativeConversationIndexer.dispose();
      await lifecycle.closeAll();
      sessionFeed.releaseAll();
    },
    getSessionCount: lifecycle.getSessionCount,
    getRetainedSessionCount: lifecycle.getRetainedSessionCount,
    hasRuntimeResources: lifecycle.hasRuntimeResources,
  };
}
