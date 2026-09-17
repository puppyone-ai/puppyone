import { useLocalization } from "@puppyone/localization";
import {
  DesktopNavigationItems,
  DesktopSidebarPluginsButton,
  DesktopSidebarSettingsButton,
} from "./DesktopNavigationItems";
import { resolveNavigationItems } from "./navigationModel";
import type { DesktopNavigationProps } from "./types";

export function DesktopSidebarRailNavigation({
  activeView,
  availableSurfaceIds,
  gitEnabled = true,
  gitIncomingCount,
  gitOperationLoading,
  gitStatus,
  workspaceChangeCount,
  onNavigate,
  onOpenPlugins,
  onOpenSettings,
  pluginsOpen = false,
  settingsOpen = false,
  showPlugins = false,
  showSettings = true,
  utilitySlot,
}: DesktopNavigationProps) {
  const { t } = useLocalization();
  const { localItems } = resolveNavigationItems({
    availableSurfaceIds,
    gitEnabled,
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
        {showPlugins && onOpenPlugins && (
          <DesktopSidebarPluginsButton
            buttonClassName="desktop-sidebar-rail-button"
            onOpenPlugins={onOpenPlugins}
            pluginsOpen={pluginsOpen}
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
