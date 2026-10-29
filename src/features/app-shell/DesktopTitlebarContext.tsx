import type { ReactNode } from "react";
import { DesktopWorkspaceSwitcher, type DesktopWorkspaceSwitcherProps } from "./DesktopWorkspaceSwitcher";
import { ProjectReachControl, type ProjectReachControlProps } from "./project-reach";
import { ProjectPlaceMenuControl, type ProjectPlaceMenuProps } from "./project-place/ProjectPlaceMenu";

/**
 * Project navigation, where the open project is, and on the project reach path
 * who can reach the project.
 *
 * A local folder and its Cloud project are two projects (puppy-issues ADR-001),
 * so the Header never switches one project between this computer and the
 * Cloud. Its place menu states where the open project is and offers the one
 * action that applies: put a folder in the Cloud, or open the other project.
 *
 * The Header states the Project only while it is the Project switcher surface.
 * When the Project rail takes that role its host renders no context at all,
 * so this component never has to describe a Project it does not own.
 */
export function DesktopTitlebarContext({ projectReach, placeMenu, locationActivity, ...project }: DesktopTitlebarContextProps) {
  return <div className="desktop-titlebar-context">
    <DesktopWorkspaceSwitcher {...project} />
    {projectReach
      ? <ProjectReachControl {...projectReach} placeMenu={placeMenu} projectMenuOpen={project.open} onOpen={project.onClose} />
      : placeMenu && <ProjectPlaceMenuControl {...placeMenu} projectMenuOpen={project.open} onOpen={project.onClose} />}
    {locationActivity}
  </div>;
}

export type DesktopTitlebarContextProps = DesktopWorkspaceSwitcherProps & {
  /** Present only on the project reach path. */
  projectReach?: ProjectReachControlProps | null;
  /** Where the open project is and the one action that applies; absent without Cloud. */
  placeMenu?: ProjectPlaceMenuProps | null;
  /**
   * Work on the project's place that outlives its dialog, such as a first
   * publish to Cloud, stated beside the project it changes.
   */
  locationActivity?: ReactNode;
};
