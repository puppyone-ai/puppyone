import { useLocalization } from "@puppyone/localization";
import {
  DesktopNavigationItems,
  DesktopSidebarCloudButton,
  DesktopSidebarSettingsButton,
} from "./DesktopNavigationItems";
import { resolveNavigationItems } from "./navigationModel";
import type { DesktopNavigationProps } from "./types";

export function DesktopSidebarRailNavigation({
  activeView,
  availableSurfaceIds,
  cloudHubEnabled = false,
  gitEnabled = true,
  pluginsEnabled = false,
  gitIncomingCount,
  gitOperationLoading,
  gitStatus,
  workspaceChangeCount,
  onNavigate,
  onOpenCloud,
  onOpenSettings,
  cloudOpen = false,
  settingsOpen = false,
  showSettings = true,
  utilitySlot,
}: DesktopNavigationProps) {
  const { t } = useLocalization();
  const { cloudHubVisible, localItems } = resolveNavigationItems({
    availableSurfaceIds,
    cloudHubEnabled,
    gitEnabled,
    pluginsEnabled,
  });
  const runtime = {
    activeView,
    gitIncomingCount,
    gitOperationLoading,
    gitStatus,
    workspaceChangeCount,
    onNavigate,
  };

  return (
    <div className="desktop-sidebar-rail-navigation" aria-label={t("shell.navigation.ariaLabel")}>
      <div className="desktop-sidebar-rail-actions">
        <DesktopNavigationItems {...runtime} buttonClassName="desktop-sidebar-rail-button" items={localItems} />
      </div>
      <div className="desktop-sidebar-rail-actions desktop-sidebar-rail-actions-end">
        {cloudHubVisible && (
          <DesktopSidebarCloudButton
            buttonClassName="desktop-sidebar-rail-button"
            cloudOpen={cloudOpen}
            onOpenCloud={onOpenCloud ?? (() => onNavigate("cloud"))}
          />
        )}
        {showSettings && (
          <DesktopSidebarSettingsButton
            buttonClassName="desktop-sidebar-rail-button"
            onOpenSettings={onOpenSettings}
            settingsOpen={settingsOpen}
          />
        )}
        {utilitySlot}
      </div>
    </div>
  );
}
