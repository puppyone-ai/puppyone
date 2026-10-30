import type { ComponentProps } from "react";
import { DesktopCloudShell } from "../components/DesktopCloudShell";
import type { ResolvedSurfaceAppearance } from "../features/appearance/AppearanceRuntime";
import { useDesktopExplorerFrame } from "../features/app-shell/layout/useDesktopExplorerFrame";
import { createCloudWorkspaceOpeningProgress, type CloudWorkspaceOpeningProgress } from "../features/cloud/files/cloudWorkspaceOpening";
import { CloudWorkspacePreparation } from "../features/cloud/workbench/CloudWorkspacePreparation";
import { useDesktopPreference } from "../features/settings";

/** Before the project answers, the wait is still the first step of opening it. */
const startingProgress = createCloudWorkspaceOpeningProgress();

/** Preparation stands in the window's Explorer column, which only the shell can supply. */
function ShellCloudWorkspacePreparation(props: Omit<ComponentProps<typeof CloudWorkspacePreparation>, "explorerFrame">) {
  return <CloudWorkspacePreparation {...props} explorerFrame={useDesktopExplorerFrame()} />;
}

/** The project's window while a Homepage open is pending, so the wait happens inside it. */
export function CloudProjectOpeningSurface({ projectName, progress = startingProgress, appearance, projectRail, onCancel }: {
  projectName: string;
  progress?: CloudWorkspaceOpeningProgress;
  appearance: ResolvedSurfaceAppearance;
  projectRail?: Pick<ComponentProps<typeof DesktopCloudShell>, "renderLeadingRail"
    | "leadingRailWidth" | "leadingRailMinWidth" | "leadingRailMaxWidth"
    | "leadingRailCollapsed" | "leadingRailCollapsedWidth" | "leadingRailCollapseThreshold"
    | "resizableLeadingRail" | "onLeadingRailCollapsedChange" | "onLeadingRailWidthChange">;
  onCancel: () => void;
}) {
  const sidebarCollapsed = useDesktopPreference(s => s.sidebarCollapsed);
  const explorerWidth = useDesktopPreference(s => s.explorerWidth);
  const setSidebarCollapsed = useDesktopPreference(s => s.setSidebarCollapsed);
  const centered = useDesktopPreference(s => s.experimentalSettings.enableCenteredProjectInHeader);
  // The rail states the project it is switching to, as it does once the project is open.
  const title = projectRail ? null : <span className="desktop-cloud-opening-title">{projectName}</span>;
  return <div className={`app-shell cloud-runtime desktop-account-cloud-workspace ${appearance.appearance.effectiveColorMode === "dark" ? "dark" : ""}`}
    {...appearance.rootProps}>
    <DesktopCloudShell active workspaceLocation="cloud" leftSidebarCollapsed={sidebarCollapsed}
      {...projectRail}
      leftSidebarWidth={explorerWidth} onLeftSidebarExpand={() => setSidebarCollapsed(false)}
      titlebarSidebarSlot={centered ? undefined : title}
      titlebarCenteredSlot={centered ? title : undefined}>
      <ShellCloudWorkspacePreparation progress={progress} onCancel={onCancel} />
    </DesktopCloudShell>
  </div>;
}
