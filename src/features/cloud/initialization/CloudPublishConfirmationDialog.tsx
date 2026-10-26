import { Tooltip, CloudUploadIcon } from "@puppyone/shared-ui";
import { RefreshCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";

export function CloudPublishConfirmationDialog({
  onCancel,
  onConfirm,
  title: customTitle,
  description,
  confirmLabel,
  busy = false,
  error,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
}) {
  const { t } = useLocalization();
  const title = customTitle ?? t("cloud.initialize.title");

  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot onClose={() => { if (!busy) onCancel(); }}>
        <DesktopDialogSurface
          className="desktop-cloud-publish-confirmation"
          width={400}
          ariaLabel={title}
        >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <span className="desktop-dialog-leading cloud" aria-hidden="true">
              <CloudUploadIcon size={17} strokeWidth={1.8} />
            </span>
            <h2>{title}</h2>
          </div>
          {!busy && <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton
            label={t("common.action.close")}
            onClick={onCancel}
          /></Tooltip>}
        </header>

        <div className="desktop-dialog-body">
          <p>{description ?? t("cloud.initialize.gitIgnoreNote")}</p>
          {error && <p role="alert">{error}</p>}
        </div>

        <footer className="desktop-dialog-footer">
          <button className="desktop-dialog-button" type="button" disabled={busy} onClick={onCancel}>
            {t("cloud.common.cancel")}
          </button>
          <button
            className="desktop-dialog-button primary"
            type="button"
            data-desktop-dialog-initial-focus="true"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {busy && <RefreshCw size={14} className="animate-spin" aria-hidden="true" />}
            {confirmLabel ?? t("cloud.common.confirm")}
          </button>
        </footer>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}
