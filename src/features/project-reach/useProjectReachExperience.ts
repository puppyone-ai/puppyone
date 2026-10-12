import { useDesktopPreference } from "../../preferencesStore";

/**
 * The single decision point for the Project Reach experience.
 *
 * Every surface that forks between the established presentation and the
 * reach presentation reads this hook. No other module may read
 * `experimentalSettings.enableProjectReach`; `scripts/check-project-reach-gate.mjs`
 * enforces that, together with the entry-point allowlist documented in
 * `README.md` of this folder.
 */
export function useProjectReachExperience(): boolean {
  return useDesktopPreference((state) => state.experimentalSettings.enableProjectReach);
}
