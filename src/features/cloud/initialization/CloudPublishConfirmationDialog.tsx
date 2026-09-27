import { CloudUpload } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";

export function CloudPublishConfirmationDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLocalization();
  const title = t("cloud.initialize.title");

  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot onClose={onCancel}>
        <DesktopDialogSurface
          className="desktop-cloud-publish-confirmation"
          width={400}
          ariaLabel={title}
        >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <span className="desktop-dialog-leading cloud" aria-hidden="true">
              <CloudUpload size={17} strokeWidth={1.8} />
            </span>
            <h2>{title}</h2>
          </div>
          <DesktopDialogCloseButton
            label={t("common.action.close")}
            onClick={onCancel}
          />
        </header>

        <div className="desktop-dialog-body">
          <p>{t("cloud.initialize.gitIgnoreNote")}</p>
        </div>

        <footer className="desktop-dialog-footer">
          <button className="desktop-dialog-button" type="button" onClick={onCancel}>
            {t("cloud.common.cancel")}
          </button>
          <button
            className="desktop-dialog-button primary"
            type="button"
            data-desktop-dialog-initial-focus="true"
            onClick={onConfirm}
          >
            {t("cloud.common.confirm")}
          </button>
        </footer>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}
