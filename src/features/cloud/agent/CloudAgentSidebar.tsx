import { useMemo, useState } from "react";
import { History, X } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { AgentEntryIcon } from "../../../components/brand/AgentEntryIcon";
import { AgentApprovalDock, AgentComposer, AgentEmptyState, AgentPanelLayout, AgentSurfaceHeader,
  AgentTranscript } from "../../desktop-agent/index";
import { cloudRunActive, type CloudAgentRun } from "./cloudAgentClient";
import { projectCloudAgentRuns } from "./cloudAgentProjection";
import type { CloudAgentController, CloudAgentState } from "./CloudAgentController";
import "./cloud-agent-sidebar.css";

export function CloudAgentSidebar({ controller, state, active, title }: {
  controller: CloudAgentController; state: CloudAgentState; active: boolean; title: string;
}) {
  const { t } = useLocalization();
  const [history, setHistory] = useState(false);
  const run = state.runs[state.runs.length - 1];
  const running = cloudRunActive(run);
  const projection = useMemo(() => projectCloudAgentRuns(state.runs), [state.runs]);
  const approval = projection.approvals[0];
  const runtimeLabel = "Puppyone Agent";
  return <div className="desktop-cloud-agent-sidebar" data-cloud-agent-project={controller.client.target.project_id}>
    <AgentPanelLayout ariaLabel={t("agent.panel.chat", { agent: runtimeLabel })} phase={run?.state ?? "ready"}
      header={<AgentSurfaceHeader title={title} runtimeLabel={runtimeLabel} runtimeIconKey="puppyone-agent"
          statusCode={running ? "running" : "ready"} statusLabel={t(statusLabelKey(run))} loading={state.loading}
          showSessionActions={false}
          agentSelector={<span className="desktop-cloud-agent-identity"><AgentEntryIcon size={15} aria-hidden="true" />{runtimeLabel}</span>}
          newSessionDisabled={state.submitting || Boolean(state.pending) || running}
          onNewSession={() => { setHistory(false); controller.newChat(); }}
          trailingActions={<>
          <Tooltip content={t("agent.history.openAria")}><button type="button" className="desktop-agent-icon-button"
            aria-label={t("agent.history.openAria")} aria-pressed={history} onClick={() => setHistory(value => !value)}>
            <History size={15} aria-hidden="true" /></button></Tooltip>
          <Tooltip content={t("shell.titlebar.hideAgent")}><button type="button" className="desktop-agent-icon-button"
            aria-label={t("shell.titlebar.hideAgent")} onClick={() => controller.setOpen(false)}>
            <X size={15} aria-hidden="true" /></button></Tooltip>
          </>} />}
      status={<CloudAgentStatus state={state} run={run}
        onRetry={() => void (state.pending ? controller.submit(state.pending.prompt) : controller.load())} />}
      conversation={history ? <div className="desktop-agent-transcript desktop-cloud-agent-history">
        {state.sessions.length ? state.sessions.map(session => <button className="desktop-agent-button is-quiet"
          key={session.id} disabled={running || state.submitting || Boolean(state.pending)}
          onClick={() => { setHistory(false); void controller.selectSession(session); }}>
          {session.title || t("agent.header.newChat")}</button>) : <p>{t("agent.history.empty")}</p>}
      </div> : <AgentTranscript projection={projection} loading={state.loading} runtimeLabel={runtimeLabel}
        working={running} pendingPrompt={state.submitting ? state.pending?.prompt : null}
        pendingSubmissionId={state.pending?.request_id}
        emptyState={<AgentEmptyState runtimeIconKey="puppyone-agent" runtimeLabel={runtimeLabel} />} />}
      dock={history ? null : <>
        {approval && <AgentApprovalDock approval={approval} queueLength={projection.approvals.length}
          resolving={state.resolving !== null} runtimeLabel={runtimeLabel}
          onResolve={decision => void controller.approve(approval.requestId, decision === "accept")} />}
        <AgentComposer draft={state.draft} onDraftChange={controller.setDraft} disabled={state.loading || state.submitting}
          inputDisabled={!active} focusRequest={active ? 1 : 0} running={running}
          stopping={Boolean(run?.stop_requested || state.resolving === "stop")}
          submitting={state.submitting} hideConfiguration runtimeLabel={runtimeLabel}
          onSubmit={controller.submit} onStop={() => void controller.stop()} />
      </>} />
  </div>;
}

function statusLabelKey(run: CloudAgentRun | undefined) {
  if (run?.state === "waiting_approval") return "agent.status.waitingForUser";
  return cloudRunActive(run) ? "agent.status.running" : "agent.header.status.ready";
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
