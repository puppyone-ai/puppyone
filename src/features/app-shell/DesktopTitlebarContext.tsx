import type { ReactNode } from "react";
import { DesktopWorkspaceSwitcher, type DesktopWorkspaceSwitcherProps } from "./DesktopWorkspaceSwitcher";
import { ProjectPlaceMenuControl, type ProjectPlaceMenuProps } from "./project-place/ProjectPlaceMenu";

/**
 * Where the open project is, then the project, read like a path: the Space
 * that holds it, this computer or another computer, then its name.
 *
 * A Space is a place, not a mode. No control switches the window into a Space;
 * the project menu lists every project by the place that holds it, and opening
 * one in another Space is how the window gets there. The place menu states the
 * place and offers what applies to it: the Space's members and plan, or who can
 * open a local folder.
 *
 * A local folder and its Cloud project are two projects (puppy-issues ADR-001),
 * so the Header never switches one project between this computer and the Cloud.
 *
 * The Header states the Project only while it is the Project switcher surface.
 * When the Project rail takes that role its host renders no context at all,
 * so this component never has to describe a Project it does not own.
 */
export function DesktopTitlebarContext({ placeMenu, locationActivity, ...project }: DesktopTitlebarContextProps) {
  return <div className="desktop-titlebar-context">
    {placeMenu && <>
      <ProjectPlaceMenuControl {...placeMenu} projectMenuOpen={project.open} onOpen={project.onClose} />
      <span className="desktop-titlebar-context-separator" aria-hidden="true">/</span>
    </>}
    <DesktopWorkspaceSwitcher {...project} />
    {locationActivity}
  </div>;
}

export type DesktopTitlebarContextProps = DesktopWorkspaceSwitcherProps & {
  /** Where the open project is and the one action that applies; absent without Cloud. */
  placeMenu?: ProjectPlaceMenuProps | null;
  /**
   * Work on the project's place that outlives its dialog, such as a first
   * publish to Cloud, stated beside the project it changes.
   */
  locationActivity?: ReactNode;
};
