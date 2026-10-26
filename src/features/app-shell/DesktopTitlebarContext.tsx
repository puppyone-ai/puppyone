import type { ReactNode } from "react";
import type { DesktopProjectCloudCopy, DesktopProjectLocation } from "./DesktopProjectLocationSwitcher";
import { DesktopProjectLocationSwitcher } from "./DesktopProjectLocationSwitcher";
import { DesktopWorkspaceSwitcher, type DesktopWorkspaceSwitcherProps } from "./DesktopWorkspaceSwitcher";
import { ProjectReachControl, type ProjectReachControlProps } from "./project-reach";

/**
 * Project navigation and provider selection are independent Header controls.
 *
 * The Header states the Project only while it is the Project switcher surface.
 * When the Project rail takes that role its host renders no context at all,
 * so this component never has to describe a Project it does not own.
 */
export function DesktopTitlebarContext({ projectLocation, cloudProject, onViewLocal, onViewCloud, projectReach, locationActivity, ...project }: DesktopTitlebarContextProps) {
  const projectMenuOpen = project.open;
  return <div className="desktop-titlebar-context">
    <DesktopWorkspaceSwitcher {...project} />
    {projectReach
      ? <ProjectReachControl {...projectReach} projectMenuOpen={projectMenuOpen} onOpen={project.onClose}
        opening={{ projectLocation, cloudProject, onViewLocal, onViewCloud }} />
      : <DesktopProjectLocationSwitcher projectLocation={projectLocation} cloudProject={cloudProject}
        onViewLocal={onViewLocal} onViewCloud={onViewCloud}
        projectMenuOpen={projectMenuOpen} onOpen={project.onClose} />}
    {locationActivity}
  </div>;
}

export type DesktopTitlebarContextProps = DesktopWorkspaceSwitcherProps & {
  projectLocation?: DesktopProjectLocation;
  cloudProject?: DesktopProjectCloudCopy;
  onViewLocal?: () => void;
  onViewCloud?: () => void;
  /** Present only on the project reach path; absent keeps the established control. */
  projectReach?: ProjectReachControlProps | null;
  /**
   * Work on the project's place that outlives its dialog, such as a first
   * publish to Cloud, stated beside the place it changes.
   */
  locationActivity?: ReactNode;
};
