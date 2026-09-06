import { redactSecretText } from "../agent-events.mjs";
import { normalizeAgentEventWorkspacePaths } from "../domain/agent-event-workspace-paths.mjs";

const PERSIST_DEBOUNCE_MS = 750;

/** Commits canonical facts and schedules process-local recovery snapshots. */
export function createAgentEventJournal({ sessionCache, logger = console }) {
  function emit(session, adapterEvent) {
    const normalizedEvent = normalizeAgentEventWorkspacePaths(adapterEvent, session.workspaceRoot);
    const envelope = session.actor.appendEvent({
      sessionId: session.id,
      runtimeId: session.runtimeId,
      providerSessionId: normalizedEvent.providerSessionId ?? session.providerSessionId,
      event: normalizedEvent,
    });
    session.updatedAt = envelope.emittedAt;
    persistSoon(session);
    return envelope;
  }

  function persistSoon(session) {
    if (session.closing || session.persistTimer) return;
    session.persistTimer = setTimeout(() => {
      session.persistTimer = null;
      void persistNow(session);
    }, PERSIST_DEBOUNCE_MS);
    session.persistTimer.unref?.();
  }

  function persistNow(session) {
    if (!session.providerSessionId) return Promise.resolve();
    const record = {
      sessionId: session.id,
      workspaceRoot: session.workspaceRoot,
      runtimeId: session.runtimeId,
      runtime: session.runtime,
      providerSessionId: session.providerSessionId,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      terminalState: session.terminalState,
      selectedModel: session.selectedModel,
      selectedEffort: session.selectedEffort,
      selectedMode: session.selectedMode,
      capabilityRevision: session.capabilities?.revision ?? null,
      lastSequence: session.sequence,
      events: session.events,
    };
    return Promise.resolve(sessionCache.save(record, {
      // Allocation is process-local. A real turn or native resume is the
      // durable-history checkpoint that promotes this locator to the catalog.
      promoteCatalog: hasDurableConversationEvidence(session.events),
    })).catch((error) => {
      logger.warn?.("Unable to update the Agent conversation metadata catalog:", redactSecretText(error?.message || String(error)));
    });
  }

  return { emit, persistNow, persistSoon };
}

function hasDurableConversationEvidence(events) {
  return Array.isArray(events) && events.some((event) => (
    event?.type === "turn.started" || event?.type === "session.resumed"
  ));
}

export const agentEventJournalLimits = Object.freeze({
  maxReplayEvents: 1_000,
  maxReplayBytes: 2 * 1024 * 1024,
  persistDebounceMs: PERSIST_DEBOUNCE_MS,
});
