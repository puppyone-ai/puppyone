import type { ReactNode } from "react";
import { DesktopWorkspaceSwitcher, type DesktopWorkspaceSwitcherProps } from "./DesktopWorkspaceSwitcher";
import { ProjectPlaceMenuControl, type ProjectPlaceMenuProps } from "./project-place/ProjectPlaceMenu";
import type { ProjectPlaceMenu } from "./project-place/projectPlaceMenuState";
import type { ProjectMenuPlace } from "./projectMenuGroups";

/**
 * Two levels, read like a path: the place (a Space, this computer or another
 * computer), then the folder.
 *
 * A Space is a place, not a mode. The place menu goes back to Home, to another
 * place (shown on Home) and to the account. The folder menu lists only the
 * folders in the open folder's place, and starts a new one; it offers Home
 * only where no place menu does.
 *
 * A local folder and its Cloud project are two projects (puppy-issues ADR-001),
 * so the Header never switches one project between this computer and the Cloud.
 *
 * The Header states the Project only while it is the Project switcher surface.
 * When the Project rail takes that role the Header keeps the place alone, so
 * this component never has to describe a Project it does not own.
 */
export function DesktopTitlebarContext({ placeMenu, locationActivity, projectHidden = false, onHome, ...project }: DesktopTitlebarContextProps) {
  return <div className="desktop-titlebar-context">
    {placeMenu && <>
      <ProjectPlaceMenuControl {...placeMenu} onHome={onHome} projectMenuOpen={project.open} onOpen={project.onClose} />
      {!projectHidden && <span className="desktop-titlebar-context-separator" aria-hidden="true">/</span>}
    </>}
    {!projectHidden && <DesktopWorkspaceSwitcher {...project} place={projectMenuPlace(placeMenu?.menu)}
      onHome={placeMenu ? undefined : onHome} />}
    {!projectHidden && locationActivity}
  </div>;
}

/** Another computer's folders are not in the account's catalog, so its menu keeps every place. */
function projectMenuPlace(menu: ProjectPlaceMenu | undefined): ProjectMenuPlace | undefined {
  if (!menu || menu.place === "computer") return undefined;
  if (menu.space) return { kind: "space", spaceId: menu.space.id };
  return { kind: menu.place };
}

export type DesktopTitlebarContextProps = DesktopWorkspaceSwitcherProps & {
  /** Where the open project is and the one action that applies; absent without Cloud. */
  placeMenu?: ProjectPlaceMenuProps | null;
  /**
   * Work on the project's place that outlives its dialog, such as a first
   * publish to Cloud, stated beside the project it changes.
   */
  locationActivity?: ReactNode;
  /** The Project rail names the project, so the Header keeps only its place. */
  projectHidden?: boolean;
};
