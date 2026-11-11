import type { ComponentProps } from "react";
import { useLocalization } from "@puppyone/localization";
import { FolderIcon } from "@puppyone/shared-ui";
import type { ProjectShell } from "../components/ProjectShell";
import { ProjectOpeningLoading } from "../components/loading";
import type { ResolvedSurfaceAppearance } from "../features/appearance/AppearanceRuntime";
import { useDesktopExplorerFrame } from "../features/app-shell/layout/useDesktopExplorerFrame";
import { ProjectPreparation } from "../features/app-shell/window-project/ProjectPreparation";
import { createCloudWorkspaceOpeningProgress, type CloudWorkspaceOpeningProgress } from "../features/cloud/files/cloudWorkspaceOpening";
import { CloudWorkspaceOpeningLoading } from "../features/cloud/workbench/CloudWorkspaceOpeningLoading";
import { ProjectWindow } from "./ProjectWindow";

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
        <FolderIcon className="desktop-titlebar-workspace-mark" size={16} strokeWidth={1.65} aria-hidden="true" />
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
  projectRail?: Pick<ComponentProps<typeof ProjectShell>, "renderLeadingRail"
    | "leadingRailWidth" | "leadingRailMinWidth" | "leadingRailMaxWidth"
    | "leadingRailCollapsed" | "leadingRailCollapsedWidth" | "leadingRailCollapseThreshold"
    | "resizableLeadingRail" | "onLeadingRailCollapsedChange" | "onLeadingRailWidthChange">;
}) {
  // The rail states the project it is switching to, as it does once the project is open.
  const title = projectRail ? null : <ProjectOpeningTitle projectName={projectName} />;
  return <ProjectWindow location={location} hosted={location === "cloud"} appearance={appearance}
    {...projectRail} titlebarSidebarSlot={title}>
    <ProjectOpeningContent location={location} progress={progress} onCancel={onCancel} />
  </ProjectWindow>;
}
