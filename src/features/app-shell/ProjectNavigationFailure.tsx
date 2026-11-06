import { useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { DesktopDialogRoot, DesktopDialogSurface } from "../../components/DesktopDialog";
import { writeClipboardText } from "../../lib/clipboard";

export function ProjectNavigationFailure({ title, message, diagnostic, onClose, onRetry, action }: {
  title?: string; message: string;
  /** The server's code and request id, so a report can be found in its log. */
  diagnostic?: string | null;
  onClose: () => void; onRetry?: () => void;
  action?: { label: string; onClick: () => void };
}) {
  const { t } = useLocalization();
  const [copied, setCopied] = useState(false);
  const copy = (value: string) => {
    void writeClipboardText(value).then(() => setCopied(true), () => setCopied(false));
  };
  return <DesktopDialogRoot onClose={onClose}>
    <DesktopDialogSurface width={420} ariaLabel={title ?? t("shell.workspaceSwitcher.switchFailed")}>
      <header className="desktop-dialog-header"><h2>{title ?? t("shell.workspaceSwitcher.switchFailed")}</h2></header>
      <div className="desktop-dialog-body">
        <p className="desktop-dialog-error" role="alert">{message}</p>
        {diagnostic && <p className="desktop-dialog-note desktop-dialog-diagnostic">
          <span className="desktop-dialog-diagnostic-text">{diagnostic}</span>
          <button type="button" className="desktop-dialog-diagnostic-copy" onClick={() => copy(diagnostic)}>
            {t(copied ? "cloud.opening.diagnosticCopied" : "cloud.opening.copyDiagnostic")}
          </button>
        </p>}
      </div>
      <footer className="desktop-dialog-footer">
        <button type="button" className={`desktop-dialog-button${!action && !onRetry ? " primary" : ""}`} onClick={onClose}>{t("common.action.close")}</button>
        {action ? <button type="button" className="desktop-dialog-button primary" onClick={action.onClick}>{action.label}</button>
          : onRetry && <button type="button" className="desktop-dialog-button primary" onClick={onRetry}>{t("cloud.common.retry")}</button>}
      </footer>
    </DesktopDialogSurface>
  </DesktopDialogRoot>;
}
