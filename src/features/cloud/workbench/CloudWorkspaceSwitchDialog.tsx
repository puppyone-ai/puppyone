import { Cloud, RefreshCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { ReactNode } from "react";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";
import { CloudWorkspaceLoadingState } from "../components/shared";
import { formatCloudMessage } from "../cloudPresentation";
import type { CloudWorkspaceSwitch } from "./useCloudWorkspaceSwitch";
import "./cloud-workspace-switch.css";

/** Authentication and preparation overlay the retained current-device workbench. */
export function CloudWorkspaceSwitchDialog({ controller, gate }: {
  controller: CloudWorkspaceSwitch;
  gate: ReactNode;
}) {
  const { t } = useLocalization();
  if (!controller.pending) return null;
  return <DesktopOverlayLayer>
    <DesktopDialogRoot onClose={controller.cancel}>
      <DesktopDialogSurface className="desktop-cloud-workspace-switch-dialog"
        width="min(720px, calc(100vw - 48px))" ariaLabel={t("cloud.productName")}>
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row"><Cloud size={15} /><h2>{t("cloud.productName")}</h2></div>
          <DesktopDialogCloseButton label={t("common.action.close")} onClick={controller.cancel} />
        </header>
        <div className="desktop-cloud-workspace-switch-content" data-po-scrollbar="content">
          {controller.error ? <div className="desktop-cloud-workspace-switch-recovery">
            <p role="alert">{formatCloudMessage(controller.error, t)}</p>
            <p>{t("cloud.recovery.localStatePreserved")}</p>
            <button type="button" className="desktop-cloud-row-action" onClick={controller.retry}>
              <RefreshCw size={13} /><span>{t("cloud.common.retry")}</span>
            </button>
          </div> : controller.checking ? <CloudWorkspaceLoadingState label={t("cloud.loading.project")} /> : gate}
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}
