import { Cloud } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { ReactNode } from "react";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../app-shell/DesktopOverlayPortal";

export type CloudDialogProps = {
  sidebar: ReactNode;
  main: ReactNode;
  onClose: () => void;
};

/**
 * Cloud is a temporary project task. It keeps its feature-owned navigation and
 * content, while the Explorer, editors, and auxiliary sidebar remain mounted
 * underneath the shared desktop overlay layer.
 */
export function CloudDialog({ sidebar, main, onClose }: CloudDialogProps) {
  const { t } = useLocalization();
  const title = t("shell.navigation.cloud");

  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot className="desktop-cloud-dialog-backdrop" onClose={onClose}>
        <DesktopDialogSurface
          className="desktop-cloud-dialog"
          width="min(960px, calc(100vw - 80px))"
          ariaLabel={title}
        >
          <header className="desktop-dialog-header desktop-cloud-dialog-header">
            <div className="desktop-dialog-title-row desktop-cloud-dialog-title-row">
              <span className="desktop-cloud-dialog-leading" aria-hidden="true">
                <Cloud size={15} strokeWidth={1.9} />
              </span>
              <h2>{title}</h2>
            </div>
            <DesktopDialogCloseButton title={t("common.action.close")} onClick={onClose} />
          </header>

          <div className="desktop-cloud-dialog-layout">
            <aside className="desktop-cloud-dialog-navigation">
              {sidebar}
            </aside>
            <div className="desktop-cloud-dialog-content">
              {main}
            </div>
          </div>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}
