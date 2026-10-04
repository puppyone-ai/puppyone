import { parseRightSidebarToolsSettings, parseTitlebarActionsSettings } from "../../preferences";
import { applyPreferenceUpdate, type PreferenceSlice } from "./preferenceActions";
import type { LayoutSlice } from "./preferenceTypes";

export const createLayoutSlice: PreferenceSlice<LayoutSlice> = (set) => ({
  explorerWidth: 320,
  setExplorerWidth: (update) => set((state) => ({ explorerWidth: applyPreferenceUpdate(update, state.explorerWidth) })),
  sidebarCollapsed: false,
  setSidebarCollapsed: (update) => set((state) => ({ sidebarCollapsed: applyPreferenceUpdate(update, state.sidebarCollapsed) })),
  projectSwitcherExpanded: false,
  setProjectSwitcherExpanded: (update) => set((state) => ({ projectSwitcherExpanded: applyPreferenceUpdate(update, state.projectSwitcherExpanded) })),
  projectSwitcherWidth: 220,
  setProjectSwitcherWidth: (update) => set((state) => ({ projectSwitcherWidth: applyPreferenceUpdate(update, state.projectSwitcherWidth) })),
  rightSidebarOpen: false,
  setRightSidebarOpen: (update) => set((state) => ({ rightSidebarOpen: applyPreferenceUpdate(update, state.rightSidebarOpen) })),
  rightSidebarWidth: 560,
  setRightSidebarWidth: (update) => set((state) => ({ rightSidebarWidth: applyPreferenceUpdate(update, state.rightSidebarWidth) })),
  rightSidebarSurface: "chat",
  setRightSidebarSurface: (update) => set((state) => ({ rightSidebarSurface: applyPreferenceUpdate(update, state.rightSidebarSurface) })),
  rightSidebarToolsSettings: parseRightSidebarToolsSettings(null),
  setRightSidebarToolsSettings: (update) => set((state) => ({ rightSidebarToolsSettings: applyPreferenceUpdate(update, state.rightSidebarToolsSettings) })),
  titlebarActionsSettings: parseTitlebarActionsSettings(null),
  setTitlebarActionsSettings: (update) => set((state) => ({ titlebarActionsSettings: applyPreferenceUpdate(update, state.titlebarActionsSettings) })),
});
