import { useDesktopPreference } from "../../preferencesStore";

/**
 * Where the window states the Project.
 *
 * - `header`: the established surface. The Header carries the Project name,
 *   the place the Project is worked on, and the menu that switches Projects.
 * - `rail`: the Project switcher experiment. A dedicated Sidebar lists every
 *   Project, each row states its own place, and choosing one switches inside
 *   this window.
 *
 * Exactly one surface owns all three facts. Two surfaces stating the same
 * Project is how a window starts disagreeing with itself, so when the rail is
 * the switcher the Header states nothing about the Project at all.
 */
export type ProjectSwitcherSurface = "header" | "rail";

/**
 * The single decision point for the Project switcher experiment. Surfaces read
 * this hook instead of `experimentalSettings.enableProjectSwitcherRail`, so the
 * fork has one definition and one place to retire.
 */
export function useProjectSwitcherSurface(): ProjectSwitcherSurface {
  const rail = useDesktopPreference((state) => state.experimentalSettings.enableProjectSwitcherRail);
  return rail ? "rail" : "header";
}
