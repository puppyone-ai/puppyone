import type { ReactNode } from "react";
import { DesktopWorkspaceSwitcher, type DesktopWorkspaceSwitcherProps } from "./DesktopWorkspaceSwitcher";
import { ProjectReachControl, type ProjectReachControlProps } from "./project-reach";

/**
 * Project navigation, and on the project reach path who can reach the project.
 *
 * A local folder and its Cloud project are two projects (puppy-issues ADR-001),
 * so the Header never switches one project between this computer and the
 * Cloud: going to the other project is a row in the project menu.
 *
 * The Header states the Project only while it is the Project switcher surface.
 * When the Project rail takes that role its host renders no context at all,
 * so this component never has to describe a Project it does not own.
 */
export function DesktopTitlebarContext({ projectReach, locationActivity, ...project }: DesktopTitlebarContextProps) {
  return <div className="desktop-titlebar-context">
    <DesktopWorkspaceSwitcher {...project} />
    {projectReach && <ProjectReachControl {...projectReach} projectMenuOpen={project.open} onOpen={project.onClose} />}
    {locationActivity}
  </div>;
}

export type DesktopTitlebarContextProps = DesktopWorkspaceSwitcherProps & {
  /** Present only on the project reach path. */
  projectReach?: ProjectReachControlProps | null;
  /**
   * Work on the project's place that outlives its dialog, such as a first
   * publish to Cloud, stated beside the project it changes.
   */
  locationActivity?: ReactNode;
};
