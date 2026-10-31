import type { ComponentProps } from "react";
import { useLocalization } from "@puppyone/localization";
import { HomeIcon } from "@puppyone/shared-ui";
import { DesktopCloudShell } from "../components/DesktopCloudShell";
import { ProjectOpeningLoading } from "../components/loading";
import type { ResolvedSurfaceAppearance } from "../features/appearance/AppearanceRuntime";
import { useDesktopExplorerFrame } from "../features/app-shell/layout/useDesktopExplorerFrame";
import { ProjectPreparation } from "../features/app-shell/ProjectPreparation";
import { createCloudWorkspaceOpeningProgress, type CloudWorkspaceOpeningProgress } from "../features/cloud/files/cloudWorkspaceOpening";
import { CloudWorkspaceOpeningLoading } from "../features/cloud/workbench/CloudWorkspaceOpeningLoading";
import { useDesktopPreference } from "../features/settings";

/** Before the project answers, the wait is still the first step of opening it. */
const startingProgress = createCloudWorkspaceOpeningProgress();

/** Preparation stands in the window's Explorer column, which only the shell can supply. */
function ShellProjectPreparation(props: Omit<ComponentProps<typeof ProjectPreparation>, "explorerFrame">) {
  return <ProjectPreparation {...props} explorerFrame={useDesktopExplorerFrame()} />;
}

/**
 * The project's window while the Homepage's open is pending, so the wait
 * happens inside it, wherever the project lives. A Cloud project says which
 * stage it has reached and can be abandoned; a local one has no stages to name.
 */
export function ProjectOpeningSurface({ location, projectName, progress = startingProgress, appearance, projectRail, onCancel }: {
  location: "local" | "cloud";
  projectName: string;
  progress?: CloudWorkspaceOpeningProgress;
  appearance: ResolvedSurfaceAppearance;
  projectRail?: Pick<ComponentProps<typeof DesktopCloudShell>, "renderLeadingRail"
    | "leadingRailWidth" | "leadingRailMinWidth" | "leadingRailMaxWidth"
    | "leadingRailCollapsed" | "leadingRailCollapsedWidth" | "leadingRailCollapseThreshold"
    | "resizableLeadingRail" | "onLeadingRailCollapsedChange" | "onLeadingRailWidthChange">;
  onCancel?: () => void;
}) {
  const { t } = useLocalization();
  const sidebarCollapsed = useDesktopPreference(s => s.sidebarCollapsed);
  const explorerWidth = useDesktopPreference(s => s.explorerWidth);
  const setSidebarCollapsed = useDesktopPreference(s => s.setSidebarCollapsed);
  // The rail states the project it is switching to, as it does once the project is open.
  const title = projectRail ? null : <div className="desktop-titlebar-context">
    <div className="desktop-titlebar-workspace-wrap">
      <span className="desktop-titlebar-workspace-button" data-project-opening="true">
        <HomeIcon className="desktop-titlebar-workspace-mark" size={16} strokeWidth={1.65} aria-hidden="true" />
        <bdi className="desktop-titlebar-workspace-name">{projectName}</bdi>
      </span>
    </div>
  </div>;
  const shellClass = location === "cloud" ? "app-shell cloud-runtime desktop-account-cloud-workspace" : "app-shell cloud-runtime";
  return <div className={`${shellClass} ${appearance.appearance.effectiveColorMode === "dark" ? "dark" : ""}`}
    {...appearance.rootProps}>
    <DesktopCloudShell active workspaceLocation={location} leftSidebarCollapsed={sidebarCollapsed}
      {...projectRail}
      leftSidebarWidth={explorerWidth} onLeftSidebarExpand={() => setSidebarCollapsed(false)}
      titlebarSidebarSlot={title}>
      <ShellProjectPreparation onCancel={onCancel}>
        {location === "cloud"
          ? <CloudWorkspaceOpeningLoading progress={progress} onCancel={onCancel} />
          : <ProjectOpeningLoading ariaLabel={t("onboarding.status.loadingProject")} />}
      </ShellProjectPreparation>
    </DesktopCloudShell>
  </div>;
}
