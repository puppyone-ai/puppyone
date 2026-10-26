import type { PreferenceSlice } from "./preferenceActions";
import type { DesktopPreferenceState, ShareSlice } from "./preferenceTypes";

/**
 * What the user has already decided about reaching their projects.
 *
 * Only one thing so far: the destination they last connected a project to.
 * It is a memory, not a setting — nothing in Settings shows or changes it,
 * and the only surface that reads it is the question it answers.
 */
export const createShareSlice: PreferenceSlice<ShareSlice> = (set) => ({
  reachLastAgentId: null,
  setReachLastAgentId: (id) => set({ reachLastAgentId: id }),
});

export const selectReachLastAgentId = (state: DesktopPreferenceState) => state.reachLastAgentId;
