import type { DesktopProjectCloudCopy, DesktopProjectLocation } from "./DesktopProjectLocationSwitcher";
import { DesktopProjectLocationSwitcher } from "./DesktopProjectLocationSwitcher";
import { DesktopWorkspaceSwitcher, type DesktopWorkspaceSwitcherProps } from "./DesktopWorkspaceSwitcher";
import { ProjectReachControl, type ProjectReachControlProps } from "./project-reach";

/** Project navigation and provider selection are independent Header controls. */
export function DesktopTitlebarContext({ projectLocation, cloudProject, onViewLocal, onViewCloud, projectReach, ...project }: DesktopTitlebarContextProps) {
  const projectMenuOpen = project.projectMenuEnabled !== false && project.open;
  return <div className="desktop-titlebar-context">
    <DesktopWorkspaceSwitcher {...project} />
    {projectReach
      // The project reach experience states who can reach this project, and is
      // the only Cloud entry on the Header while it is on.
      ? <ProjectReachControl {...projectReach} projectMenuOpen={projectMenuOpen} onOpen={project.onClose} />
      : <DesktopProjectLocationSwitcher projectLocation={projectLocation} cloudProject={cloudProject}
        onViewLocal={onViewLocal} onViewCloud={onViewCloud}
        projectMenuOpen={projectMenuOpen} onOpen={project.onClose} />}
  </div>;
}

export type DesktopTitlebarContextProps = DesktopWorkspaceSwitcherProps & {
  projectLocation?: DesktopProjectLocation;
  cloudProject?: DesktopProjectCloudCopy;
  onViewLocal?: () => void;
  onViewCloud?: () => void;
  /** Present only on the project reach path; absent keeps the established control. */
  projectReach?: ProjectReachControlProps | null;
};
