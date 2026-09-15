import { Settings } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../components/DesktopDialog";
import {
  createSettingsWorkspaceSurface,
  type SettingsWorkspaceSurfaceProps,
} from "./SettingsWorkspaceSurface";

export type SettingsDialogProps = SettingsWorkspaceSurfaceProps & {
  onClose: () => void;
};

/**
 * Settings is a temporary application task, not a Workspace destination.
 * Its existing navigation and content stay feature-owned while the dialog
 * shell preserves the Explorer, editors, and auxiliary sidebar underneath.
 */
export function SettingsDialog({ onClose, ...settings }: SettingsDialogProps) {
  const { t } = useLocalization();
  const surface = createSettingsWorkspaceSurface(settings);
  const title = t("shell.navigation.settings");

  return (
    <DesktopDialogRoot className="desktop-settings-dialog-backdrop" onClose={onClose}>
      <DesktopDialogSurface
        className="desktop-settings-dialog"
        width="min(960px, calc(100vw - 80px))"
        ariaLabel={title}
      >
        <header className="desktop-dialog-header desktop-settings-dialog-header">
          <div className="desktop-dialog-title-row desktop-settings-dialog-title-row">
            <span className="desktop-settings-dialog-leading" aria-hidden="true">
              <Settings size={15} strokeWidth={1.9} />
            </span>
            <h2>{title}</h2>
          </div>
          <DesktopDialogCloseButton title={t("common.action.close")} onClick={onClose} />
        </header>

        <div className="desktop-settings-dialog-layout">
          <aside className="desktop-settings-dialog-navigation">
            {surface.sidebar}
          </aside>
          <main className="desktop-settings-dialog-content">
            {surface.main}
          </main>
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  );
}
