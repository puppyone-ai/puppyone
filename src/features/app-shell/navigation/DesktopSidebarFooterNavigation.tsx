import { DesktopNavigationItems, DesktopSidebarSettingsButton } from "./DesktopNavigationItems";
import { resolveNavigationItems } from "./navigationModel";
import type { DesktopNavigationProps } from "./types";

export function DesktopSidebarFooterNavigation({
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
  onOpenSettings,
  showSettings = true,
  utilitySlot,
}: DesktopNavigationProps) {
  const { cloudHubItems, localItems } = resolveNavigationItems({
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
    <div
      className="desktop-sidebar-footer-bar desktop-sidebar-navigation-surface horizontal"
      data-placement="bottom"
      data-orientation="horizontal"
    >
      <div className="desktop-sidebar-footer-actions desktop-sidebar-footer-actions-left">
        <DesktopNavigationItems {...runtime} buttonClassName="desktop-sidebar-footer-button" items={localItems} />
        {cloudHubItems.length > 0 && (
          <DesktopNavigationItems {...runtime} buttonClassName="desktop-sidebar-footer-button" items={cloudHubItems} />
        )}
        {showSettings && (
          <DesktopSidebarSettingsButton
            activeView={activeView}
            buttonClassName="desktop-sidebar-footer-button"
            onOpenSettings={onOpenSettings}
          />
        )}
      </div>
      {utilitySlot != null && (
        <div className="desktop-sidebar-footer-actions desktop-sidebar-footer-actions-right">
          {utilitySlot}
        </div>
      )}
    </div>
  );
}
