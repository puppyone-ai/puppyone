import type { ReactNode } from "react";
import { CloudIcon, Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";

/** A single publish task, never a directory of Cloud services. Closing only hides it. */
export function CloudPublishDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const { t } = useLocalization();
  const title = t("cloud.placeMenu.putInCloud");
  return <DesktopOverlayLayer>
    <DesktopDialogRoot className="desktop-cloud-dialog-backdrop" onClose={onClose}>
      <DesktopDialogSurface className="desktop-cloud-dialog desktop-cloud-publish-dialog" width={720} ariaLabel={title}>
        <header className="desktop-dialog-header desktop-cloud-dialog-header">
          <div className="desktop-dialog-title-row desktop-cloud-dialog-title-row">
            <span className="desktop-cloud-dialog-leading" aria-hidden="true"><CloudIcon size={15} /></span>
            <h2>{title}</h2>
          </div>
          <Tooltip content={t("common.action.close")}>
            <DesktopDialogCloseButton label={t("common.action.close")} onClick={onClose} />
          </Tooltip>
        </header>
        <div className="desktop-cloud-publish-dialog-content">{children}</div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}
