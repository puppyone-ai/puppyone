import { useStore } from "zustand";
import { persist } from "zustand/middleware";
import { createStore, type StateCreator } from "zustand/vanilla";
import { createAgentSlice } from "./features/settings/agentSlice";
import { createAppearanceSlice } from "./features/settings/appearanceSlice";
import { createEditorSlice } from "./features/settings/editorSlice";
import { createExperimentsSlice } from "./features/settings/experimentsSlice";
import { createGitDisplaySlice } from "./features/settings/gitDisplaySlice";
import { createLayoutSlice } from "./features/settings/layoutSlice";
import { createShareSlice } from "./features/settings/shareSlice";
import { browserPreferenceStorage, createPreferencePersistence, emptyPreferenceStorage, type PreferenceStorage, type PersistedDesktopPreferences } from "./features/settings/preferencesPersistence";
import type { DesktopPreferenceState } from "./features/settings/preferenceTypes";
export type { DesktopPreferenceState } from "./features/settings/preferenceTypes";
const createPreferences: StateCreator<DesktopPreferenceState> = (...args) => ({
  ...createAppearanceSlice(...args), ...createLayoutSlice(...args), ...createGitDisplaySlice(...args),
  ...createAgentSlice(...args), ...createEditorSlice(...args), ...createExperimentsSlice(...args),
  ...createShareSlice(...args),
});
export const desktopPreferencesStore = createStore<DesktopPreferenceState>()(persist<DesktopPreferenceState, [], [], PersistedDesktopPreferences>(createPreferences, {
  // Virtual adapter name: no aggregate key or duplicate preference document is written.
  name: "desktop-preferences", partialize: state => state, storage: createPreferencePersistence(emptyPreferenceStorage), skipHydration: true,
}));
let initialized = false;
/** Call before rendering a smoke/test surface to give it isolated storage. */
export function initializeDesktopPreferences(storage: PreferenceStorage = browserPreferenceStorage()) {
  desktopPreferencesStore.persist.setOptions({ storage: createPreferencePersistence(emptyPreferenceStorage) });
  desktopPreferencesStore.setState(desktopPreferencesStore.getInitialState(), true);
  desktopPreferencesStore.persist.setOptions({ storage: createPreferencePersistence(storage) });
  void desktopPreferencesStore.persist.rehydrate();
  initialized = true;
  const systemDark = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches : false;
  desktopPreferencesStore.setState({ systemDark }); // Flush normalized defaults/migrations through the single persist owner.
}
export function useDesktopPreference<T>(selector: (state: DesktopPreferenceState) => T): T {
  if (!initialized) initializeDesktopPreferences();
  return useStore(desktopPreferencesStore, selector);
}
export { selectAgentPreferredRoute } from "./features/settings/agentSlice";
export { selectFileIconTheme } from "./features/settings/appearanceSlice";
export { selectReachLastAgentId } from "./features/settings/shareSlice";
