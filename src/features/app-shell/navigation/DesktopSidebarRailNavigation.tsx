import { useLocalization } from "@puppyone/localization";
import { DesktopNavigationItems, DesktopSidebarSettingsButton } from "./DesktopNavigationItems";
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
  onOpenSettings,
  showSettings = true,
  utilitySlot,
}: DesktopNavigationProps) {
  const { t } = useLocalization();
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
    <div className="desktop-sidebar-rail-navigation" aria-label={t("shell.navigation.ariaLabel")}>
      <div className="desktop-sidebar-rail-actions">
        <DesktopNavigationItems {...runtime} buttonClassName="desktop-sidebar-rail-button" items={localItems} />
      </div>
      <div className="desktop-sidebar-rail-actions desktop-sidebar-rail-actions-end">
        {cloudHubItems.length > 0 && (
          <DesktopNavigationItems {...runtime} buttonClassName="desktop-sidebar-rail-button" items={cloudHubItems} />
        )}
        {showSettings && (
          <DesktopSidebarSettingsButton
            activeView={activeView}
            buttonClassName="desktop-sidebar-rail-button"
            onOpenSettings={onOpenSettings}
          />
        )}
        {utilitySlot}
      </div>
    </div>
  );
}
