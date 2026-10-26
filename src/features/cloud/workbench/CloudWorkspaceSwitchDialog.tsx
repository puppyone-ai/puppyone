import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { useEffect, type ReactNode } from "react";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import { CloudWorkspaceLoadingState } from "../components/shared";
import { CloudProjectActivationScope } from "../components/CloudProjectActivation";
import type { CloudWorkspaceSwitch } from "./useCloudWorkspaceSwitch";
import "./cloud-workspace-switch.css";
import { CloudWorkspaceRecovery } from "./CloudWorkspaceRecovery";

/** Authentication and preparation overlay the retained current-device workbench. */
export function CloudWorkspaceSwitchDialog({ controller, gate, projectName, authenticationRequired = false, preparingInPlace = false, onOpenAccount }: {
  controller: CloudWorkspaceSwitch;
  gate: ReactNode;
  /** Names the retained local project in the activation surface. */
  projectName?: string | null;
  authenticationRequired?: boolean;
  preparingInPlace?: boolean;
  onOpenAccount?: () => void;
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
        width={600}
        ariaLabel={t("cloud.activation.project.title")}>
        {/* Content owns the visible headline; the Header keeps only the title for structure and the close action. */}
        <header className="desktop-cloud-workspace-switch-header">
          <h2 className="desktop-cloud-workspace-switch-title">{t("cloud.activation.project.title")}</h2>
          <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton label={t("common.action.close")} onClick={controller.cancel} /></Tooltip>
        </header>
        <div className="desktop-cloud-workspace-switch-content" data-po-scrollbar="content">
          <CloudProjectActivationScope projectName={projectName} onDismiss={controller.cancel}>
            {controller.error ? <CloudWorkspaceRecovery message={controller.error}
              title={t("cloud.opening.failedTitle")}
              onRetry={controller.recoveryAction === "retry" ? controller.retry : undefined}
              actions={controller.recoveryAction === "account" && onOpenAccount ? <button type="button" className="desktop-dialog-button" onClick={onOpenAccount}>{t("settings.sidebar.account")}</button> : undefined}
              /> : controller.checking ? <CloudWorkspaceLoadingState label={t("cloud.loading.project")} /> : gate}
          </CloudProjectActivationScope>
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}
