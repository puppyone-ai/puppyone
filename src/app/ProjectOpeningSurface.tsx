import type { ComponentProps } from "react";
import { useLocalization } from "@puppyone/localization";
import { HomeIcon } from "@puppyone/shared-ui";
import { DesktopCloudShell } from "../components/DesktopCloudShell";
import { ProjectOpeningLoading } from "../components/loading";
import type { ResolvedSurfaceAppearance } from "../features/appearance/AppearanceRuntime";
import { useDesktopExplorerFrame } from "../features/app-shell/layout/useDesktopExplorerFrame";
import { ProjectPreparation } from "../features/app-shell/window-project/ProjectPreparation";
import { createCloudWorkspaceOpeningProgress, type CloudWorkspaceOpeningProgress } from "../features/cloud/files/cloudWorkspaceOpening";
import { CloudWorkspaceOpeningLoading } from "../features/cloud/workbench/CloudWorkspaceOpeningLoading";
import { useDesktopPreference } from "../features/settings";

/** Before the project answers, the wait is still the first step of opening it. */
const startingProgress = createCloudWorkspaceOpeningProgress();

type ProjectOpeningProps = {
  location: "local" | "cloud";
  progress?: CloudWorkspaceOpeningProgress;
  onCancel?: () => void;
};

/** The project's name in its usual place, for a window with no project menu to keep. */
function ProjectOpeningTitle({ projectName }: { projectName: string }) {
  return <div className="desktop-titlebar-context">
    <div className="desktop-titlebar-workspace-wrap">
      <span className="desktop-titlebar-workspace-button" data-project-opening="true">
        <HomeIcon className="desktop-titlebar-workspace-mark" size={16} strokeWidth={1.65} aria-hidden="true" />
        <bdi className="desktop-titlebar-workspace-name">{projectName}</bdi>
      </span>
    </div>
  </div>;
}

/**
 * The wait for a project, inside a project shell, which supplies its Explorer
 * column. A Cloud project says which stage it has reached and can be abandoned;
 * a local one has no stages to name.
 */
export function ProjectOpeningContent({ location, progress = startingProgress, onCancel }: ProjectOpeningProps) {
  const { t } = useLocalization();
  return <ProjectPreparation explorerFrame={useDesktopExplorerFrame()} onCancel={onCancel}>
    {location === "cloud"
      ? <CloudWorkspaceOpeningLoading progress={progress} onCancel={onCancel} />
      : <ProjectOpeningLoading ariaLabel={t("onboarding.status.loadingProject")} />}
  </ProjectPreparation>;
}

/** The project's window for an open that starts with no project on screen. */
export function ProjectOpeningSurface({ location, projectName, progress, appearance, projectRail, onCancel }: ProjectOpeningProps & {
  projectName: string;
  appearance: ResolvedSurfaceAppearance;
  projectRail?: Pick<ComponentProps<typeof DesktopCloudShell>, "renderLeadingRail"
    | "leadingRailWidth" | "leadingRailMinWidth" | "leadingRailMaxWidth"
    | "leadingRailCollapsed" | "leadingRailCollapsedWidth" | "leadingRailCollapseThreshold"
    | "resizableLeadingRail" | "onLeadingRailCollapsedChange" | "onLeadingRailWidthChange">;
}) {
  const sidebarCollapsed = useDesktopPreference(s => s.sidebarCollapsed);
  const explorerWidth = useDesktopPreference(s => s.explorerWidth);
  const setSidebarCollapsed = useDesktopPreference(s => s.setSidebarCollapsed);
  // The rail states the project it is switching to, as it does once the project is open.
  const title = projectRail ? null : <ProjectOpeningTitle projectName={projectName} />;
  const shellClass = location === "cloud" ? "app-shell cloud-runtime desktop-account-cloud-workspace" : "app-shell cloud-runtime";
  return <div className={`${shellClass} ${appearance.appearance.effectiveColorMode === "dark" ? "dark" : ""}`}
    {...appearance.rootProps}>
    <DesktopCloudShell active workspaceLocation={location} leftSidebarCollapsed={sidebarCollapsed}
      {...projectRail}
      leftSidebarWidth={explorerWidth} onLeftSidebarExpand={() => setSidebarCollapsed(false)}
      titlebarSidebarSlot={title}>
      <ProjectOpeningContent location={location} progress={progress} onCancel={onCancel} />
    </DesktopCloudShell>
  </div>;
}
