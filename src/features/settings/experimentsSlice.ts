import { parseExperimentalSettings } from "../../preferences";
import { applyPreferenceUpdate, type PreferenceSlice } from "./preferenceActions";
import type { ExperimentsSlice } from "./preferenceTypes";

export const createExperimentsSlice: PreferenceSlice<ExperimentsSlice> = (set, get) => ({
  experimentalSettings: parseExperimentalSettings(null),
  setExperimentalSettings: (update) => {
    const current = get().experimentalSettings;
    const next = applyPreferenceUpdate(update, current);
    set({ experimentalSettings: { ...next, enableGitAutoCommit: current.enableGitAutoCommit } });
    const desktop = window.puppyoneDesktop;
    if (next.enableComputerMode !== current.enableComputerMode) {
      void desktop?.localComputers?.setExperimentalOptIn({
        enabled: next.enableComputerMode,
      }).catch(() => undefined);
    }
    if (!desktop?.setGitAutoCommitExperimentalOptIn || next.enableGitAutoCommit === current.enableGitAutoCommit) return;
    void desktop.setGitAutoCommitExperimentalOptIn({ enabled: next.enableGitAutoCommit }).then((snapshot) => {
      set((state) => ({ experimentalSettings: {
        ...state.experimentalSettings, enableGitAutoCommit: snapshot.experimentalOptIn === true,
      } }));
    }).catch(() => undefined);
  },
});
