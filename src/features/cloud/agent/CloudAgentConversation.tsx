import { useMemo, useSyncExternalStore } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { AgentApprovalDock, AgentComposer, AgentEmptyState, AgentPanelLayout,
  AgentTranscript } from "../../desktop-agent/index";
import { cloudRunActive, type CloudAgentRun } from "./cloudAgentClient";
import { projectCloudAgentRuns } from "./cloudAgentProjection";
import type { CloudAgentController, CloudAgentState } from "./CloudAgentController";
import "./cloud-agent-sidebar.css";

export function CloudAgentConversation({ controller, active, focusRequest }: {
  controller: CloudAgentController; active: boolean; focusRequest?: number;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { t } = useLocalization();
  const run = state.runs[state.runs.length - 1];
  const running = cloudRunActive(run);
  const projection = useMemo(() => projectCloudAgentRuns(state.runs), [state.runs]);
  const approval = projection.approvals[0];
  const runtimeLabel = "Puppyone Agent";
  return <div className="desktop-cloud-agent-sidebar" data-cloud-agent-project={controller.client.target.project_id}>
    <AgentPanelLayout ariaLabel={t("agent.panel.chat", { agent: runtimeLabel })} phase={run?.state ?? "ready"}
      status={<CloudAgentStatus state={state} run={run}
        onRetry={() => void (state.pending ? controller.submit(state.pending.prompt) : controller.load())} />}
      conversation={<AgentTranscript projection={projection} loading={state.loading} runtimeLabel={runtimeLabel}
        working={running} pendingPrompt={state.submitting ? state.pending?.prompt : null}
        pendingSubmissionId={state.pending?.request_id}
        emptyState={<AgentEmptyState runtimeIconKey="puppyone-agent" runtimeLabel={runtimeLabel} />} />}
      dock={<>
        {approval && <AgentApprovalDock approval={approval} queueLength={projection.approvals.length}
          resolving={state.resolving !== null} runtimeLabel={runtimeLabel}
          onResolve={decision => void controller.approve(approval.requestId, decision === "accept")} />}
        <AgentComposer draft={state.draft} onDraftChange={controller.setDraft} disabled={state.loading || state.submitting}
          inputDisabled={!active} focusRequest={active ? focusRequest : 0} running={running}
          stopping={Boolean(run?.stop_requested || state.resolving === "stop")}
          submitting={state.submitting} hideConfiguration runtimeLabel={runtimeLabel}
          onSubmit={controller.submit} onStop={() => void controller.stop()} />
      </>} />
  </div>;
}

function CloudAgentStatus({ state, run, onRetry }: { state: CloudAgentState; run?: CloudAgentRun; onRetry: () => void }) {
  const { t } = useLocalization();
  const exceptional = run && ["conflict", "outcome_unknown", "failed"].includes(run.state) ? run : null;
  return <>
        {state.reconnecting && <div className="desktop-agent-syncing" role="status">{t("agent.lifecycle.reconnecting")}</div>}
        {state.error && <div className="desktop-agent-readiness is-recovery" role="alert">
          <div className="desktop-agent-readiness-copy"><strong>{t(errorLabelKey(state.error))}</strong>
            <details><summary>{t("agent.header.diagnostics")}</summary><p>{state.error.message}</p></details></div>
          <button className="desktop-agent-button is-secondary" onClick={onRetry}>{t("common.action.retry")}</button>
        </div>}
        {exceptional && <div className="desktop-agent-inline-error" role="status">
          <span>{t(`cloud.agent.${exceptional.state}`)}</span>
          {exceptional.snapshot.code && <details><summary>{t("agent.header.diagnostics")}</summary><code>{exceptional.snapshot.code}</code></details>}
        </div>}
  </>;
}

function errorLabelKey(error: Error) {
  const status = (error as Error & { status?: number }).status;
  if (status === 401) return "cloud.auth.signInRequired";
  if (status === 403) return "cloud.agent.permissionDenied";
  if (status === 409) return "cloud.agent.busy";
  return "cloud.agent.connectionError";
}
