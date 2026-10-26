import { useDesktopPreference } from "../../preferencesStore";

/**
 * The single decision point between the existing Desktop surfaces and the
 * "who can reach this project" path.
 *
 * Every surface that forks — the Header project control, the share entry and
 * the sidebar notice for changes made elsewhere — reads this hook at its own
 * render entry and renders either the existing component or a new one. No leaf
 * component takes the flag, and no surface reads
 * `experimentalSettings.enableProjectReach` directly; `scripts/check-project-reach-gate.mjs`
 * enforces both rules.
 *
 * Only presentation forks. Share and Git facts keep one owner, so the two paths
 * can never describe the same project differently.
 *
 * Contract and retirement plan: puppy-issues
 * `document/puppyone-desktop/platform/experimental-path-forks.md`.
 */
export function useProjectReachExperience(): boolean {
  return useDesktopPreference((state) => state.experimentalSettings.enableProjectReach);
}
