import { parseDiffMarkers, parseGitDisplayMode } from "../../preferences";
import { applyPreferenceUpdate, type PreferenceSlice } from "./preferenceActions";
import type { GitDisplaySlice } from "./preferenceTypes";

export const createGitDisplaySlice: PreferenceSlice<GitDisplaySlice> = (set) => ({
  diffMarkers: parseDiffMarkers(null),
  setDiffMarkers: (update) => set((state) => ({ diffMarkers: applyPreferenceUpdate(update, state.diffMarkers) })),
  gitDisplayMode: parseGitDisplayMode(null),
  setGitDisplayMode: (update) => set((state) => ({ gitDisplayMode: applyPreferenceUpdate(update, state.gitDisplayMode) })),
});
