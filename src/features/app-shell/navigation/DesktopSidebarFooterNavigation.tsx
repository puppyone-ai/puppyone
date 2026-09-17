import {
  DesktopNavigationItems,
  DesktopSidebarPluginsButton,
  DesktopSidebarSettingsButton,
} from "./DesktopNavigationItems";
import { resolveNavigationItems } from "./navigationModel";
import type { DesktopNavigationProps } from "./types";

export function DesktopSidebarFooterNavigation({
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
    <div
      className="desktop-sidebar-footer-bar desktop-sidebar-navigation-surface horizontal"
      data-placement="bottom"
      data-orientation="horizontal"
    >
      <div className="desktop-sidebar-footer-actions desktop-sidebar-footer-actions-left">
        <DesktopNavigationItems {...runtime} buttonClassName="desktop-sidebar-footer-button" items={localItems} />
        {showPlugins && onOpenPlugins && (
          <DesktopSidebarPluginsButton
            buttonClassName="desktop-sidebar-footer-button"
            onOpenPlugins={onOpenPlugins}
            pluginsOpen={pluginsOpen}
          />
        )}
        {showSettings && (
          <DesktopSidebarSettingsButton
            buttonClassName="desktop-sidebar-footer-button"
            onOpenSettings={onOpenSettings}
            settingsOpen={settingsOpen}
          />
        )}
        {utilitySlot}
      </div>
    </div>
  );
}
