import { useLocalization } from "@puppyone/localization";
import type { SidebarNavigationOrientation } from "../../../preferences";
import {
  DesktopNavigationItems,
  DesktopSidebarCloudButton,
  DesktopSidebarSettingsButton,
} from "./DesktopNavigationItems";
import { resolveNavigationItems } from "./navigationModel";
import type { DesktopNavigationProps } from "./types";

export function DesktopSidebarTopNavigation({
  activeView,
  availableSurfaceIds,
  cloudHubEnabled = false,
  gitEnabled = true,
  pluginsEnabled = false,
  orientation,
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
  shellToolbar = false,
  useToolLabels = false,
}: DesktopNavigationProps & {
  orientation: SidebarNavigationOrientation;
  shellToolbar?: boolean;
  useToolLabels?: boolean;
}) {
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
  const buttonClassName = [
    "desktop-sidebar-top-navigation-button",
    shellToolbar ? "desktop-shell-toolbar-button" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={`desktop-sidebar-top-navigation desktop-sidebar-navigation-surface ${orientation}${shellToolbar ? " desktop-shell-toolbar-navigation desktop-shell-toolbar-section" : ""}`}
      data-placement="top"
      data-orientation={orientation}
      data-shell-toolbar-section={shellToolbar ? "navigation" : undefined}
    >
      <div
        className={`desktop-sidebar-top-navigation-list${shellToolbar ? " desktop-shell-toolbar-list" : ""}`}
        aria-label={t("shell.navigation.ariaLabel")}
      >
        <div className={`desktop-sidebar-top-navigation-group desktop-sidebar-top-navigation-local${shellToolbar ? " desktop-shell-toolbar-group" : ""}`}>
          <DesktopNavigationItems
            {...runtime}
            buttonClassName={buttonClassName}
            items={localItems}
            labelIdOverrides={useToolLabels ? { git: "shell.navigation.git" } : undefined}
            shellToolbar={shellToolbar}
            showLabel
          />
          {cloudHubVisible && (
            <DesktopSidebarCloudButton
              buttonClassName={buttonClassName}
              cloudOpen={cloudOpen}
              onOpenCloud={onOpenCloud ?? (() => onNavigate("cloud"))}
              shellToolbar={shellToolbar}
              showLabel
            />
          )}
          {showSettings && (
            <DesktopSidebarSettingsButton
              buttonClassName={buttonClassName}
              onOpenSettings={onOpenSettings}
              settingsOpen={settingsOpen}
              shellToolbar={shellToolbar}
              showLabel
            />
          )}
        </div>
        {utilitySlot != null && (
          <div className="desktop-sidebar-top-navigation-utility">
            {utilitySlot}
          </div>
        )}
      </div>
    </div>
  );
}
