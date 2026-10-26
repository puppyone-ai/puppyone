import { RefreshCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { DisclosureIcon } from "@puppyone/shared-ui";
import type { ReactNode } from "react";
import { formatCloudMessage, type CloudMessageDescriptor } from "../cloudPresentation";
import { cloudFailureTitle } from "../cloudOpeningFailure";
import "./cloud-workspace-switch.css";

/** The same recovery presentation serves the retained workspace and its dialog. */
export function CloudWorkspaceRecovery({ title, message, onRetry, actions, showLocalState = false }: {
  title?: string;
  message: string | CloudMessageDescriptor;
  onRetry?: () => void;
  actions?: ReactNode;
  showLocalState?: boolean;
}) {
  const { t } = useLocalization();
  const descriptor = typeof message === "string" ? undefined : message;
  const titleKey = descriptor ? cloudFailureTitle(descriptor) : undefined;
  const diagnostic = descriptor?.diagnostic;
  return <section className="desktop-cloud-workspace-switch-recovery">
    <div className="desktop-cloud-workspace-recovery-copy" role="alert">
      <strong>{titleKey ? t(titleKey) : title ?? t("cloud.recovery.title")}</strong>
      <p>{descriptor ? formatCloudMessage({ ...descriptor, detail: undefined }, t) : message as string}</p>
      {(diagnostic || showLocalState) && <details className="desktop-cloud-recovery-details">
        <summary><DisclosureIcon size={12} />{t("cloud.common.details")}</summary>
        {diagnostic && <dl>
          {diagnostic.status && <><dt>{t("cloud.recovery.responseStatus")}</dt><dd>{t("cloud.recovery.httpStatus", { status: diagnostic.status })}</dd></>}
          {diagnostic.code && <><dt>{t("cloud.recovery.errorCode")}</dt><dd>{diagnostic.code}</dd></>}
        </dl>}
        {showLocalState && <small>{t("cloud.recovery.localStatePreserved")}</small>}
      </details>}
    </div>
    {(onRetry || actions) && <div className="desktop-cloud-workspace-recovery-actions">
      {onRetry && <button type="button" className="desktop-dialog-button" onClick={onRetry}>
        <RefreshCw size={13} aria-hidden="true" /><span>{t("cloud.common.retry")}</span>
      </button>}
      {actions}
    </div>}
  </section>;
}
