import { useLocalization } from "@puppyone/localization";
import {
  DesktopNavigationItems,
  DesktopSidebarSettingsButton,
} from "./DesktopNavigationItems";
import { resolveNavigationItems } from "./navigationModel";
import type { DesktopNavigationProps } from "./types";

export function DesktopSidebarRailNavigation({
  activeView,
  availableSurfaceIds,
  gitEnabled = true,
  pluginsEnabled = false,
  gitIncomingCount,
  gitOperationLoading,
  gitStatus,
  workspaceChangeCount,
  onNavigate,
  onOpenSettings,
  settingsOpen = false,
  showSettings = true,
  utilitySlot,
}: DesktopNavigationProps) {
  const { t } = useLocalization();
  const { localItems } = resolveNavigationItems({
    availableSurfaceIds,
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
