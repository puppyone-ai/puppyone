import { useLocalization } from "@puppyone/localization";
import { DesktopDialogRoot, DesktopDialogSurface } from "../../components/DesktopDialog";

export function ProjectNavigationFailure({ title, message, onClose, onRetry, action }: {
  title?: string; message: string; onClose: () => void; onRetry?: () => void;
  action?: { label: string; onClick: () => void };
}) {
  const { t } = useLocalization();
  return <DesktopDialogRoot onClose={onClose}>
    <DesktopDialogSurface width={420} ariaLabel={title ?? t("shell.workspaceSwitcher.switchFailed")}>
      <header className="desktop-dialog-header"><h2>{title ?? t("shell.workspaceSwitcher.switchFailed")}</h2></header>
      <div className="desktop-dialog-body"><p className="desktop-dialog-error" role="alert">{message}</p></div>
      <footer className="desktop-dialog-footer">
        <button type="button" className={`desktop-dialog-button${!action && !onRetry ? " primary" : ""}`} onClick={onClose}>{t("common.action.close")}</button>
        {action ? <button type="button" className="desktop-dialog-button primary" onClick={action.onClick}>{action.label}</button>
          : onRetry && <button type="button" className="desktop-dialog-button primary" onClick={onRetry}>{t("cloud.common.retry")}</button>}
      </footer>
    </DesktopDialogSurface>
  </DesktopDialogRoot>;
}
