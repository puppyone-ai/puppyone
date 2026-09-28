import { CircleAlert, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentRuntimeReadiness } from "../domain/agent-contract";
import type { AgentErrorDescriptor } from "../application/agent-error";
import { presentAgentError } from "./agentErrorPresentation";
import { presentRuntimeReadiness } from "./agentPanelPresentation";
import type { AgentControllerState } from "../application/agent-controller-state";

type AgentPanelStatusProps = {
  unavailable: boolean;
  failed: boolean;
  error: AgentErrorDescriptor | null;
  runtimeLabel: string;
  readiness?: AgentRuntimeReadiness;
  onRetry: () => void;
  recovery?: AgentControllerState["displayRecovery"];
  stopRequest?: AgentControllerState["stopRequest"];
  onPauseRecovery?: () => void;
  onRetryRecovery?: () => void;
  onManageExecutions?: () => void;
};

export function AgentPanelStatus({
  unavailable,
  failed,
  error,
  runtimeLabel,
  readiness,
  onRetry,
  recovery, stopRequest, onPauseRecovery, onRetryRecovery, onManageExecutions,
}: AgentPanelStatusProps) {
  const { t } = useLocalization();
  const errorPresentation = presentAgentError(error, t);
  const readinessPresentation = presentRuntimeReadiness(readiness, runtimeLabel, t);
  const detail = failed ? errorPresentation?.detail : readinessPresentation.detail;
  const displayFailure = error?.code === "event-gap" || recovery?.policy === "paused" || recovery?.policy === "exhausted";
  return (
    <>
      {(unavailable || (failed && !displayFailure)) && (
        <AgentStatusCard
          tone={failed ? "recovery" : "readiness"}
          heading={failed
            ? t("agent.readiness.sessionAttention", { agent: bidiIsolate(runtimeLabel) })
            : readinessPresentation.heading}
          description={failed
            ? errorPresentation?.summary || t("agent.readiness.sessionRecovery")
            : detail}
          details={<>
            {!failed && <small className="desktop-agent-readiness-detail desktop-agent-readiness-code">{t("agent.readiness.statusCode", { code: readinessPresentation.code })}</small>}
            {!failed && readinessPresentation.diagnostic && (
              <small className="desktop-agent-readiness-detail" dir="auto">{t("agent.readiness.diagnostic", { detail: bidiIsolate(readinessPresentation.diagnostic) })}</small>
            )}
            {failed && detail && <small className="desktop-agent-readiness-detail" dir="auto">{detail}</small>}
          </>}
          actions={<button
            type="button"
            className="desktop-agent-button is-secondary desktop-agent-readiness-action"
            aria-label={t("agent.readiness.retryAria")}
            onClick={onRetry}
          ><RefreshCw size={12} /> {t(failed ? "agent.readiness.reconnect" : "common.action.retry")}</button>}
        />
      )}
      {errorPresentation && !unavailable && !failed && !displayFailure && (
        <div className="desktop-agent-inline-error" role="alert">
          <CircleAlert size={14} />
          <span>{errorPresentation.summary}</span>
          {errorPresentation.detail && <small dir="auto">{errorPresentation.detail}</small>}
        </div>
      )}
      {(displayFailure || stopRequest) && <AgentStatusCard
        tone="recovery"
        heading={t(displayFailure ? "agent.lifecycle.displayStale" : "agent.lifecycle.stopPending")}
        description={t(recovery?.policy === "paused" ? "agent.lifecycle.paused" : recovery?.policy === "exhausted"
            ? "agent.lifecycle.exhausted" : displayFailure ? "agent.lifecycle.retryProgress" : "agent.lifecycle.stopUnconfirmed",
            { attempt: recovery?.attempt ?? 0, maximum: recovery?.maxAttempts ?? 5 })}
        actions={<>
          {displayFailure && <>
            <button type="button" className="desktop-agent-button is-secondary desktop-agent-readiness-action" onClick={onRetryRecovery}>{t("agent.lifecycle.retryDisplay")}</button>
            {(!recovery || recovery.policy === "automatic") && <button type="button" className="desktop-agent-button is-secondary desktop-agent-readiness-action" onClick={onPauseRecovery}>{t("agent.lifecycle.pauseDisplay")}</button>}
          </>}
          <button type="button" className="desktop-agent-button is-secondary desktop-agent-readiness-action" onClick={onManageExecutions}>{t("agent.lifecycle.manageExecutions")}</button>
        </>}
      />}
    </>
  );
}

function AgentStatusCard({
  tone,
  heading,
  description,
  details = null,
  actions,
}: {
  tone: "readiness" | "recovery";
  heading: ReactNode;
  description: ReactNode;
  details?: ReactNode;
  actions: ReactNode;
}) {
  return <div className={`desktop-agent-readiness is-${tone}`} role="status">
    <CircleAlert className="desktop-agent-readiness-icon" size={14} strokeWidth={1.8} aria-hidden="true" />
    <div className="desktop-agent-readiness-copy">
      <strong className="desktop-agent-readiness-title">{heading}</strong>
      <p className="desktop-agent-readiness-description">{description}</p>
      {details}
    </div>
    <div className="desktop-agent-readiness-actions">{actions}</div>
  </div>;
}
