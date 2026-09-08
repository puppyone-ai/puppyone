import { redactSecretText } from "../agent-events.mjs";
import { normalizeAgentEventWorkspacePaths } from "../domain/agent-event-workspace-paths.mjs";

const PERSIST_DEBOUNCE_MS = 750;

/** Commits canonical facts and schedules process-local recovery snapshots. */
export function createAgentEventJournal({ sessionCache, logger = console }) {
  function emit(session, adapterEvent) {
    let envelope;
    try {
      const normalizedEvent = normalizeAgentEventWorkspacePaths(adapterEvent, session.workspaceRoot);
      envelope = session.actor.appendEvent({
        sessionId: session.id,
        runtimeId: session.runtimeId,
        providerSessionId: normalizedEvent.providerSessionId ?? session.providerSessionId,
        event: normalizedEvent,
      });
    } catch (error) {
      // A bad display item must not terminate the native stream consumer. Keep
      // the failure visible and let later, valid native objects continue.
      const type = typeof adapterEvent?.type === "string" ? adapterEvent.type.slice(0, 80) : "unknown";
      logger.warn?.("Agent display translation rejected an item", { type, stage: "main-commit" });
      envelope = session.actor.appendEvent({ sessionId: session.id, runtimeId: session.runtimeId,
        providerSessionId: session.providerSessionId, event: { type: "provider.error", turnId: session.activeTurnId,
          itemId: null, payload: { code: "AGENT_DISPLAY_ITEM_INVALID", stage: "main-commit", recoverable: true,
            message: "An Agent content item could not be displayed.", diagnostic: redactSecretText(error?.message || String(error)).slice(0, 1_000) } } });
      if (["turn.completed", "turn.failed", "turn.interrupted"].includes(type)) {
        try {
          session.actor.appendEvent({ sessionId: session.id, runtimeId: session.runtimeId,
            providerSessionId: session.providerSessionId,
            event: { type, turnId: adapterEvent.turnId, payload: { status: type.slice(5) } } });
        } catch { session.actor.dispatch({ type: "recovery.unconfirmed", reason: "invalid-native-terminal-identity" }); }
      } else if (type === "approval.requested" || type === "question.requested") {
        session.actor.dispatch({ type: "recovery.unconfirmed", reason: "invalid-native-request-identity" });
      }
    }
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
      sourceScopeId: session.sourceScopeId ?? "default",
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
      // Only adapter/native-store evidence can make a locator reopenable.
      promoteCatalog: session.nativePersistenceConfirmed === true,
    })).catch((error) => {
      logger.warn?.("Unable to update the Agent conversation metadata catalog:", redactSecretText(error?.message || String(error)));
    });
  }

  return { emit, persistNow, persistSoon };
}

export const agentEventJournalLimits = Object.freeze({
  maxReplayEvents: 1_000,
  maxReplayBytes: 2 * 1024 * 1024,
  persistDebounceMs: PERSIST_DEBOUNCE_MS,
});
