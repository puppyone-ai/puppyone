import { useEffect, useRef, useState } from "react";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopDialogRoot, DesktopDialogSurface, DesktopDialogCloseButton } from "../../../components/DesktopDialog";
import { AgentLauncherIcon } from "../../../components/brand/AgentLauncherIcon";
import type { ActivationOperation, ActivationPlan } from "../../../../shared/local-agent-activation/types";
import { ACTIVATION_STEPS, isActivationActive } from "../../../../shared/local-agent-activation/schema.mjs";
import type { LocalAgentActivationStore } from "./LocalAgentActivationStore";
import "./local-agent-activation.css";

export function LocalAgentActivationDialog({ setupId, displayName, surface, operation, store, onClose }: {
  setupId: string; displayName: string; surface: "chat" | "terminal"; operation?: ActivationOperation;
  store: LocalAgentActivationStore; onClose: () => void;
}) {
  const { t } = useLocalization();
  const [plan, setPlan] = useState<ActivationPlan | null>(null);
  const [planRevision, setPlanRevision] = useState(0);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(!operation);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!confirming || !store.bridge) return;
    let current = true;
    setPlan(null); setError(false);
    void store.bridge.plan({ setupId, surface }).then(value => { if (current) setPlan(value); })
      .catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [setupId, surface, store, confirming, planRevision]);
  const active = operation && isActivationActive(operation.status);
  async function perform(work: () => Promise<unknown>, after?: () => void) {
    setError(false); setBusy(true);
    try { await work(); if (mounted.current) after?.(); }
    catch { if (mounted.current) setError(true); }
    finally { if (mounted.current) setBusy(false); }
  }
  const action = (kind: Parameters<LocalAgentActivationStore["act"]>[1]) => {
    if (operation) void perform(() => store.act(operation.operationId, kind));
  };
  return <DesktopOverlayLayer><DesktopDialogRoot onClose={onClose}>
    <DesktopDialogSurface className="local-agent-activation-dialog" width={420} ariaLabel={t("settings.agentSetup.activate", { agent: displayName })}>
      <header className="desktop-dialog-header">
        <div className="local-agent-activation-title"><AgentLauncherIcon launcherId={setupId} /><h2>{t("settings.agentSetup.activate", { agent: displayName })}</h2></div>
        <DesktopDialogCloseButton title={t("common.action.close")} onClick={onClose} />
      </header>
      <div className="desktop-dialog-body local-agent-activation-body">
        {confirming ? <>
          <p>{t(plan?.mode === "guided" ? "settings.activation.guided" : "settings.activation.consent", { agent: displayName })}</p>
          <ol className="local-agent-activation-steps">{ACTIVATION_STEPS.map(id => <li key={id}>{t(`settings.activation.step.${id}`)}</li>)}</ol>
          <p className="local-agent-activation-note">{t("settings.activation.control")}</p>
          {plan?.mode === "automatic" && <details><summary>{t("settings.activation.details")}</summary>
            <p>{plan.publisher} · {plan.version}</p><p>{t("settings.activation.location")}</p>
          </details>}
          {setupId === "claude" && surface === "chat" && <p className="local-agent-activation-note">{t("settings.agentSetup.claude")}</p>}
        </> : operation && <>
          <ol className="local-agent-activation-steps">{operation.steps.map((step, index) => <li key={step.id}
            data-state={step.status} aria-current={step.status === "running" ? "step" : undefined}>
            <span aria-hidden="true" className="local-agent-activation-step-number">{["complete", "skipped"].includes(step.status) ? "✓" : index + 1}</span>
            <span>{t(`settings.activation.step.${step.id}`)}</span>
          </li>)}</ol>
          <p role="status" aria-live="polite">{t(`settings.activation.status.${operation.status}`)}</p>
          {operation.errorCode && operation.status === "failed" && <p className="desktop-dialog-error">{t(`settings.activation.error.${operation.errorCode}`)}</p>}
          {operation.installed && ["cancelled", "failed", "interrupted"].includes(operation.status)
            && <p className="local-agent-activation-note">{t("settings.activation.retained")}</p>}
        </>}
        {error && <div role="alert"><p className="desktop-dialog-error">{t("settings.activation.requestFailed")}</p>
          <button type="button" className="desktop-dialog-button" onClick={() => {
            if (confirming) setPlanRevision(value => value + 1);
            else void perform(() => store.refresh());
          }}>{t("settings.activation.refresh")}</button></div>}
      </div>
      <footer className="desktop-dialog-footer">
        {confirming ? <>
          <button className="desktop-dialog-button" onClick={onClose}>{t("common.action.cancel")}</button>
          <button className="desktop-dialog-button primary" disabled={!plan || busy} onClick={() => { if (plan) void perform(() => store.start(plan.planId), () => setConfirming(false)); }}>
            {t(plan?.mode === "guided" ? "settings.activation.beginGuided" : "settings.activation.start")}</button>
        </> : <>
          {active && <button className="desktop-dialog-button" disabled={operation.status === "cancelling"}
            onClick={() => action("cancel")}>{t("settings.activation.cancel")}</button>}
          {!active && operation && operation.status !== "ready" && <button className="desktop-dialog-button" onClick={() => setConfirming(true)}>{t("settings.activation.retry")}</button>}
          {operation?.status === "setup-required" && <>
            <button className="desktop-dialog-button" disabled={busy} onClick={() => action("guide")}>{t("settings.agentSetup.guide")}</button>
            <button className="desktop-dialog-button primary" disabled={busy} onClick={() => action("check")}>{t("settings.activation.check")}</button>
          </>}
          <button className="desktop-dialog-button" onClick={() => {
            if (!active && operation) void perform(() => store.act(operation.operationId, "dismiss"), onClose);
            else onClose();
          }}>{t(active ? "settings.activation.background" : "common.action.close")}</button>
        </>}
      </footer>
    </DesktopDialogSurface>
  </DesktopDialogRoot></DesktopOverlayLayer>;
}
