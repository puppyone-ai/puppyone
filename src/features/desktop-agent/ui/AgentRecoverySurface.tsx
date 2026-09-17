import { useState } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type { AgentTurnRecovery } from "../domain/agent-projection-types";

type AgentRecoverySurfaceProps = {
  recovery: AgentTurnRecovery;
  runtimeLabel: string;
  submitting: boolean;
  onContinue: () => void;
};

/** Provider-neutral action surface for a completed native turn that still needs work. */
export function AgentRecoverySurface({
  recovery,
  runtimeLabel,
  submitting,
  onContinue,
}: AgentRecoverySurfaceProps) {
  const { t } = useLocalization();
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <section
      className="desktop-agent-recovery"
      data-recovery-kind={recovery.kind}
      aria-label={t("agent.recovery.degraded.ariaLabel")}
      aria-live="polite"
    >
      <header>
        <span className="desktop-agent-recovery-icon" aria-hidden="true"><CircleAlert size={15} /></span>
        <strong>{t("agent.recovery.degraded.title")}</strong>
      </header>
      <p>{t("agent.recovery.degraded.description", { agent: bidiIsolate(runtimeLabel) })}</p>
      {detailsOpen && (
        <dl className="desktop-agent-recovery-details">
          <div><dt>{t("agent.recovery.degraded.code")}</dt><dd><code>{recovery.code}</code></dd></div>
          <div><dt>{t("agent.recovery.degraded.scope")}</dt><dd>{t(`agent.recovery.degraded.scope.${recovery.failureScope}`)}</dd></div>
          <div><dt>{t("agent.recovery.degraded.transport")}</dt><dd>{t(`agent.recovery.degraded.transport.${recovery.transportHealth}`)}</dd></div>
          <div><dt>{t("agent.recovery.degraded.sideEffects")}</dt><dd>{t(`agent.recovery.degraded.sideEffects.${recovery.sideEffects}`)}</dd></div>
        </dl>
      )}
      <footer>
        <button
          type="button"
          className="desktop-agent-button is-secondary"
          onClick={() => setDetailsOpen((value) => !value)}
        >
          {t(detailsOpen ? "agent.recovery.degraded.hideDetails" : "agent.recovery.degraded.details")}
        </button>
        <button
          type="button"
          className="desktop-agent-button is-primary"
          disabled={submitting}
          aria-busy={submitting}
          onClick={onContinue}
        >
          {submitting && <LoaderCircle size={12} className="desktop-agent-spin" aria-hidden="true" />}
          {t(submitting ? "agent.recovery.degraded.continuing" : "agent.recovery.degraded.continue")}
        </button>
      </footer>
    </section>
  );
}
