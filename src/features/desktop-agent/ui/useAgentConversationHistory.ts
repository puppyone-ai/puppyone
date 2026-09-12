import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  AGENT_HISTORY_CATALOG_TIMEOUT_MS,
  AGENT_HISTORY_RUNTIME_TIMEOUT_MS,
  AGENT_HISTORY_SOURCE_TIMEOUT_MS,
  type ConversationHistoryController,
} from "../application/ConversationHistoryController";

export {
  AGENT_HISTORY_CATALOG_TIMEOUT_MS,
  AGENT_HISTORY_RUNTIME_TIMEOUT_MS,
  AGENT_HISTORY_SOURCE_TIMEOUT_MS,
};

type Options = {
  active: boolean;
  controller: ConversationHistoryController;
  excludedSessionIds: readonly string[];
  retainWhileHidden?: boolean;
};

/**
 * Reads PuppyOne's locator catalog only while the History drill-down is open.
 * Native discovery remains a separate, capability-gated operation controlled
 * by the owning History surface.
 */
export function useAgentConversationHistory({
  active,
  controller,
  excludedSessionIds,
  retainWhileHidden = false,
}: Options) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    if (active) controller.activate();
    else controller.deactivate();
    return () => { if (!retainWhileHidden) controller.deactivate(); };
  }, [active, controller, retainWhileHidden]);

  const excluded = useMemo(() => new Set(excludedSessionIds), [excludedSessionIds]);
  const visibleSessions = useMemo(
    () => state.sessions.filter((session) => !excluded.has(session.id)),
    [excluded, state.sessions],
  );

  return {
    ...state,
    sessions: visibleSessions,
    excludedSessionCount: state.sessions.length - visibleSessions.length,
    hasMore: Boolean(state.catalogNextCursor) || Object.keys(state.nextCursors).length > 0,
    refreshNative: controller.refresh.bind(controller),
    loadMoreNative: controller.loadMore.bind(controller),
  };
}
