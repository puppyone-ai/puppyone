import { CircleAlert } from "lucide-react";
import { Button } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../DesktopOverlayPortal";
import type { AuxiliaryWorkbenchPendingClose } from "./useAuxiliaryWorkbenchCloseCoordinator";
import "./auxiliary-workbench-close-dialog.css";

type AuxiliaryWorkbenchCloseDialogProps = Readonly<{
  pending: AuxiliaryWorkbenchPendingClose;
  committing: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}>;

export function AuxiliaryWorkbenchCloseDialog({
  pending,
  committing,
  onConfirm,
  onDismiss,
}: AuxiliaryWorkbenchCloseDialogProps) {
  const { t } = useLocalization();
  const { decision } = pending;
  const confirmation = decision.kind === "confirm";

  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot
        dismissalPolicy="dismissible"
        dismissOnBackdrop
        onClose={onDismiss}
      >
        <DesktopDialogSurface
          width={380}
          className="desktop-workbench-close-dialog"
          ariaLabel={decision.dialog.title}
        >
          <header className="desktop-dialog-header">
            <div className="desktop-dialog-title-row">
              <span
                className={`desktop-dialog-leading desktop-workbench-close-dialog-icon${confirmation ? " is-danger" : ""}`}
                aria-hidden="true"
              >
                <CircleAlert size={16} strokeWidth={1.7} />
              </span>
              <h2>{decision.dialog.title}</h2>
            </div>
            <DesktopDialogCloseButton
              title={t("common.action.close")}
              onClick={onDismiss}
            />
          </header>

          <div className="desktop-dialog-body">
            <p>{decision.dialog.detail}</p>
          </div>

          <footer className="desktop-dialog-footer">
            {confirmation && (
              <Button
                className="desktop-workbench-close-dialog-action"
                tone="neutral"
                data-desktop-dialog-initial-focus="true"
                onClick={onDismiss}
              >
                {t(committing ? "common.action.close" : "common.action.cancel")}
              </Button>
            )}
            <Button
              className="desktop-workbench-close-dialog-action"
              tone={confirmation ? decision.tone : "neutral"}
              disabled={committing}
              data-desktop-dialog-initial-focus={confirmation ? undefined : "true"}
              onClick={confirmation ? onConfirm : onDismiss}
            >
              {decision.dialog.actionLabel}
            </Button>
          </footer>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}
