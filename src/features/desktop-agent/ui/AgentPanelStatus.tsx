import { CircleAlert, RefreshCw } from "lucide-react";
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
        <div className="desktop-agent-readiness" role="status">
          <CircleAlert size={15} />
          <div>
            <strong>{failed
              ? t("agent.readiness.sessionAttention", { agent: bidiIsolate(runtimeLabel) })
              : readinessPresentation.heading}</strong>
            <p>{failed
              ? errorPresentation?.summary || t("agent.readiness.sessionRecovery")
              : detail}</p>
            {!failed && <small className="desktop-agent-readiness-code">{t("agent.readiness.statusCode", { code: readinessPresentation.code })}</small>}
            {!failed && readinessPresentation.diagnostic && (
              <small dir="auto">{t("agent.readiness.diagnostic", { detail: bidiIsolate(readinessPresentation.diagnostic) })}</small>
            )}
            {failed && detail && <small dir="auto">{detail}</small>}
          </div>
          <button type="button" aria-label={t("agent.readiness.retryAria")} onClick={onRetry}><RefreshCw size={14} /> {t("common.action.retry")}</button>
        </div>
      )}
      {errorPresentation && !unavailable && !failed && !displayFailure && (
        <div className="desktop-agent-inline-error" role="alert">
          <CircleAlert size={14} />
          <span>{errorPresentation.summary}</span>
          {errorPresentation.detail && <small dir="auto">{errorPresentation.detail}</small>}
        </div>
      )}
      {(displayFailure || stopRequest) && <div className="desktop-agent-readiness" role="status">
        <CircleAlert size={15} />
        <div>
          <strong>{t(displayFailure ? "agent.lifecycle.displayStale" : "agent.lifecycle.stopPending")}</strong>
          <p>{t(recovery?.policy === "paused" ? "agent.lifecycle.paused" : recovery?.policy === "exhausted"
            ? "agent.lifecycle.exhausted" : displayFailure ? "agent.lifecycle.retryProgress" : "agent.lifecycle.stopUnconfirmed",
            { attempt: recovery?.attempt ?? 0, maximum: recovery?.maxAttempts ?? 5 })}</p>
          {displayFailure && <>
            <button type="button" onClick={onRetryRecovery}>{t("agent.lifecycle.retryDisplay")}</button>
            {(!recovery || recovery.policy === "automatic") && <button type="button" onClick={onPauseRecovery}>{t("agent.lifecycle.pauseDisplay")}</button>}
          </>}
          <button type="button" onClick={onManageExecutions}>{t("agent.lifecycle.manageExecutions")}</button>
        </div>
      </div>}
    </>
  );
}
