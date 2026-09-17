import { Blocks } from "lucide-react";
import { useState } from "react";
import type { ViewerPackSnapshot } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../app-shell/DesktopOverlayPortal";
import { PluginsView } from "./PluginsView";
import {
  DEFAULT_PLUGINS_SECTION,
  PluginsSidebar,
  type PluginsSection,
} from "./PluginsSidebar";

export type PluginsDialogProps = {
  hostAvailable: boolean;
  snapshot: ViewerPackSnapshot;
  onRefresh: () => void | Promise<void>;
  onClose: () => void;
};

/** Plugins is an application task layered over the current Project. */
export function PluginsDialog({
  hostAvailable,
  snapshot,
  onRefresh,
  onClose,
}: PluginsDialogProps) {
  const { t } = useLocalization();
  const [activeSection, setActiveSection] = useState<PluginsSection>(DEFAULT_PLUGINS_SECTION);
  const title = t("shell.navigation.plugins");

  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot className="desktop-plugins-dialog-backdrop" onClose={onClose}>
        <DesktopDialogSurface
          className="desktop-plugins-dialog"
          width="min(960px, calc(100vw - 80px))"
          ariaLabel={title}
        >
          <header className="desktop-dialog-header desktop-plugins-dialog-header">
            <div className="desktop-dialog-title-row desktop-plugins-dialog-title-row">
              <span className="desktop-plugins-dialog-leading" aria-hidden="true">
                <Blocks size={15} strokeWidth={1.9} />
              </span>
              <h2>{title}</h2>
            </div>
            <DesktopDialogCloseButton title={t("common.action.close")} onClick={onClose} />
          </header>

          <div className="desktop-plugins-dialog-layout">
            <aside className="desktop-plugins-dialog-navigation">
              <PluginsSidebar
                activeSection={activeSection}
                installedCount={snapshot.contributions.length}
                onSelectSection={setActiveSection}
              />
            </aside>
            <main className="desktop-plugins-dialog-content">
              <PluginsView
                activeSection={activeSection}
                hostAvailable={hostAvailable}
                snapshot={snapshot}
                onRefresh={onRefresh}
                onSelectSection={setActiveSection}
              />
            </main>
          </div>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}
