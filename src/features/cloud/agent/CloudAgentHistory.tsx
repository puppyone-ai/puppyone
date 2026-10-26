import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { AgentConversationHistory, type AgentSessionListItem } from "../../desktop-agent";
import type { AuxiliaryWorkbenchHistoryBrowserContext } from "../../../lib/workbench/types";
import { CLOUD_AGENT_LABEL, type CloudAgentWorkbench } from "./CloudAgentWorkbench";

/** Adapt server locators only; the native history component owns all presentation. */
export function CloudAgentHistory({ workbench, excludedResourceIds, openingTargetId, onBack, onOpen }: AuxiliaryWorkbenchHistoryBrowserContext & { workbench: CloudAgentWorkbench }) {
  const { t } = useLocalization();
  const state = useSyncExternalStore(workbench.subscribeHistory, workbench.getHistory);
  useEffect(() => { void workbench.refreshHistory(); }, [workbench]);
  const sessions = useMemo<AgentSessionListItem[]>(() => state.sessions.filter(session => !excludedResourceIds.includes(session.id)).map(session => ({
    id: session.id, provider: "cloud-pi", runtimeId: "cloud-pi",
    runtime: { id: "cloud-pi", displayName: CLOUD_AGENT_LABEL, iconKey: "puppyone-agent" },
    providerSessionId: session.id, workspaceRoot: workbench.store.context.rootPath,
    title: session.title || t("agent.header.newChat"), createdAt: session.updated_at, updatedAt: session.updated_at,
    terminalState: "idle", selectedModel: null, lastSequence: 0,
  })), [state.sessions, excludedResourceIds, workbench, t]);
  const settledStatus = state.loaded ? "complete" : "not-requested";
  return <div className="desktop-agent-boundary desktop-agent-runtime-launcher is-history">
    <AgentConversationHistory sessions={sessions} runtimes={[]} loading={!state.loaded && state.loading}
    refreshing={state.loaded && state.loading} loadingMore={false} hasMore={false} error={state.error}
    excludedSessionCount={state.sessions.length - sessions.length} openingSessionId={openingTargetId}
    sources={{ "cloud-pi": { runtimeId: "cloud-pi", status: state.error ? "failed" : settledStatus,
      coverage: state.sessions.length < 200 ? "complete" : "unknown", nextCursor: null, scanId: null, indexed: state.sessions.length, warnings: [] } }}
    onOpen={session => {
      const payload = state.sessions.find(row => row.id === session.id);
      if (payload) onOpen({ id: session.id, title: session.title, iconKey: "puppyone-agent", payload });
    }} onRefresh={() => { void workbench.refreshHistory(); }} onLoadMore={() => {}} onBack={onBack} />
  </div>;
}
