import { RefreshCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { ReactNode } from "react";
import "./cloud-workspace-switch.css";

/** The same recovery presentation serves the retained workspace and its dialog. */
export function CloudWorkspaceRecovery({ title, message, onRetry, actions, showLocalState = false }: {
  title?: string;
  message: string;
  onRetry?: () => void;
  actions?: ReactNode;
  showLocalState?: boolean;
}) {
  const { t } = useLocalization();
  return <section className="desktop-cloud-workspace-switch-recovery">
    <div className="desktop-cloud-workspace-recovery-copy" role="alert">
      <strong>{title ?? t("cloud.recovery.title")}</strong>
      <p>{message}</p>
      {showLocalState && <details><summary>{t("cloud.common.details")}</summary><small>{t("cloud.recovery.localStatePreserved")}</small></details>}
    </div>
    {(onRetry || actions) && <div className="desktop-cloud-workspace-recovery-actions">
      {onRetry && <button type="button" className="desktop-dialog-button" onClick={onRetry}>
        <RefreshCw size={13} aria-hidden="true" /><span>{t("cloud.common.retry")}</span>
      </button>}
      {actions}
    </div>}
  </section>;
}
