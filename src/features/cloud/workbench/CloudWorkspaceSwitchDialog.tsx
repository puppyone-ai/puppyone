import { Tooltip } from "@puppyone/shared-ui";
import { CloudIcon as Cloud } from "../../../components/icons/CloudIcon";
import { useLocalization } from "@puppyone/localization";
import { useEffect, type ReactNode } from "react";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";
import { CloudWorkspaceLoadingState } from "../components/shared";
import { formatCloudMessage } from "../cloudPresentation";
import type { CloudWorkspaceSwitch } from "./useCloudWorkspaceSwitch";
import "./cloud-workspace-switch.css";
import { CloudWorkspaceRecovery } from "./CloudWorkspaceRecovery";

/** Authentication and preparation overlay the retained current-device workbench. */
export function CloudWorkspaceSwitchDialog({ controller, gate, authenticationRequired = false, preparingInPlace = false }: {
  controller: CloudWorkspaceSwitch;
  gate: ReactNode;
  authenticationRequired?: boolean;
  preparingInPlace?: boolean;
}) {
  const { t } = useLocalization();
  const inlinePreparation = controller.pending && (controller.checking || preparingInPlace) && !authenticationRequired;
  const cancel = controller.cancel;
  useEffect(() => {
    if (!inlinePreparation) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      cancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancel, inlinePreparation]);
  // An already-authenticated, resolved repository switch prepares in place.
  // Keep the retained Header visible and commit only after root preflight; a
  // dialog is reserved for authentication or actionable recovery.
  if (!controller.pending || inlinePreparation) return null;
  return <DesktopOverlayLayer>
    <DesktopDialogRoot className="desktop-cloud-dialog-backdrop" onClose={controller.cancel}>
      <DesktopDialogSurface className={`desktop-cloud-workspace-switch-dialog${authenticationRequired ? " is-authentication" : ""}`}
        width={880}
        ariaLabel={t(authenticationRequired ? "cloud.auth.desktopTitle" : "cloud.productName")}>
        <header className="desktop-dialog-header desktop-cloud-dialog-header">
          <div className="desktop-dialog-title-row desktop-cloud-dialog-title-row">
            <span className="desktop-cloud-dialog-leading" aria-hidden="true"><Cloud size={15} /></span>
            <h2>{t("cloud.productName")}</h2>
          </div>
          <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton label={t("common.action.close")} onClick={controller.cancel} /></Tooltip>
        </header>
        <div className="desktop-cloud-workspace-switch-content" data-po-scrollbar="content">
          {controller.error ? <CloudWorkspaceRecovery message={formatCloudMessage(controller.error, t)}
            onRetry={controller.retry} showLocalState /> : controller.checking ? <CloudWorkspaceLoadingState label={t("cloud.loading.project")} /> : gate}
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}
