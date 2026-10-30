import type { PersistStorage } from "zustand/middleware";
import { parseAgentRoutingPreferences, serializeAgentRoutingPreferences } from "../../agentRoutingPreferences";
import * as keys from "../../preferences";
import * as legacy from "../../preferenceStorage";
import {
APPEARANCE_PREFERENCES_STORAGE_KEY,createAppearancePreferencesV6,readAppearancePreferences,
readLegacyAppearanceDocument,
readLegacyAppearanceSnapshot,
removeLegacyAppearancePreferences,
serializeAppearancePreferences,
type AppearancePreferencesV6,
} from "../appearance";
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const emptyPreferenceStorage: PreferenceStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};
export function browserPreferenceStorage(): PreferenceStorage {
  try { return window.localStorage; } catch { return emptyPreferenceStorage; }
}
export function appearanceFields(p: AppearancePreferencesV6) {
  return {
    interfaceStyle: p.activeRootThemeId, byRootTheme: p.byRootTheme,
    typographyPreferences: p.shared.typography, pointerCursors: p.shared.pointerCursors,
    showFileIcons: p.shared.showFileIcons,
    fileIconTheme: p.shared.fileIconTheme,
    loadingPlaceholderStyle: p.shared.loadingPlaceholderStyle,
    markdownPresentation: p.bySurface.markdown,
  };
}
function readPreferences(storage: PreferenceStorage, onReadFailure: () => void) {
  const safe = { getItem: (key: string) => { try { return storage.getItem(key); } catch { onReadFailure(); return null; } } };
  const appearance = readAppearancePreferences(
    safe.getItem(APPEARANCE_PREFERENCES_STORAGE_KEY) ?? readLegacyAppearanceDocument(safe),
    readLegacyAppearanceSnapshot(safe),
  );
  return {
    ...appearanceFields(appearance.preferences), appearanceWritable: appearance.writable,
    diffMarkers: legacy.readInitialDiffMarkers(safe),
    gitDisplayMode: legacy.readInitialGitDisplayMode(safe),
    filesVisibilitySettings: legacy.readInitialFilesVisibilitySettings(safe),
    createNewMenuSettings: legacy.readInitialCreateNewMenuSettings(safe),
    experimentalSettings: legacy.readInitialExperimentalSettings(safe),
    rightSidebarToolsSettings: legacy.readInitialRightSidebarToolsSettings(safe),
    titlebarActionsSettings: legacy.readInitialTitlebarActionsSettings(safe),
    localAgentsSettings: legacy.readInitialLocalAgentsSettings(safe),
    agentFileActivityIndicatorsEnabled: legacy.readInitialAgentFileActivityIndicatorsEnabled(safe),
    aiEditAssistEnabled: legacy.readInitialAiEditAssistEnabled(safe),
    explorerWidth: legacy.readInitialExplorerWidth(safe),
    sidebarCollapsed: legacy.readInitialSidebarCollapsed(safe),
    projectSwitcherExpanded: legacy.readInitialProjectSwitcherExpanded(safe),
    projectSwitcherWidth: legacy.readInitialProjectSwitcherWidth(safe),
    rightSidebarWidth: legacy.readInitialRightSidebarWidth(safe),
    rightSidebarSurface: legacy.readInitialRightSidebarSurface(safe),
    homepageDesktopPositions: legacy.readInitialHomepageDesktopPositions(safe),
    homepageProjectLayout: legacy.readInitialHomepageProjectLayout(safe),
    reachLastAgentId: legacy.readInitialReachLastAgent(safe),
    agentRoutingPreferences: parseAgentRoutingPreferences(safe.getItem(legacy.AGENT_ROUTING_PREFERENCES_STORAGE_KEY), {
      legacyRuntimeId: legacy.readInitialAgentPreferredRuntime(safe), legacyModelId: legacy.readInitialAgentPreferredModel(safe),
    }),
  };
}
export type PersistedDesktopPreferences = ReturnType<typeof readPreferences>;

function serializeAppearance(s: PersistedDesktopPreferences) {
  return serializeAppearancePreferences(createAppearancePreferencesV6({
    activeRootThemeId: s.interfaceStyle,
    shared: { typography: s.typographyPreferences, pointerCursors: s.pointerCursors,
      showFileIcons: s.showFileIcons, loadingPlaceholderStyle: s.loadingPlaceholderStyle,
      fileIconTheme: s.fileIconTheme, sidebarNavigationLayout: keys.DEFAULT_SIDEBAR_NAVIGATION_LAYOUT },
    byRootTheme: s.byRootTheme, bySurface: { markdown: s.markdownPresentation },
  }));
}
function serializePreferences(s: PersistedDesktopPreferences): Record<string, string> {
  const { enableGitAutoCommit: _mainOwned, ...rendererOwned } = s.experimentalSettings;
  void _mainOwned;
  return {
    ...(s.appearanceWritable ? { [APPEARANCE_PREFERENCES_STORAGE_KEY]: serializeAppearance(s) } : {}),
    [keys.DIFF_MARKERS_STORAGE_KEY]: s.diffMarkers,
    [keys.GIT_DISPLAY_MODE_STORAGE_KEY]: s.gitDisplayMode,
    [keys.FILES_VISIBILITY_STORAGE_KEY]: JSON.stringify(s.filesVisibilitySettings),
    [keys.CREATE_NEW_MENU_STORAGE_KEY]: JSON.stringify(s.createNewMenuSettings),
    [keys.EXPERIMENTAL_SETTINGS_STORAGE_KEY]: JSON.stringify(rendererOwned),
    [keys.RIGHT_SIDEBAR_TOOLS_STORAGE_KEY]: JSON.stringify(s.rightSidebarToolsSettings),
    [keys.TITLEBAR_ACTIONS_STORAGE_KEY]: JSON.stringify(s.titlebarActionsSettings),
    [keys.LOCAL_AGENTS_STORAGE_KEY]: JSON.stringify(s.localAgentsSettings),
    [keys.AGENT_FILE_ACTIVITY_INDICATORS_STORAGE_KEY]: String(s.agentFileActivityIndicatorsEnabled),
    [keys.AI_EDIT_ASSIST_STORAGE_KEY]: String(s.aiEditAssistEnabled),
    [legacy.EXPLORER_WIDTH_STORAGE_KEY]: String(s.explorerWidth),
    [legacy.SIDEBAR_COLLAPSED_STORAGE_KEY]: String(s.sidebarCollapsed),
    [legacy.PROJECT_SWITCHER_EXPANDED_STORAGE_KEY]: String(s.projectSwitcherExpanded),
    [legacy.PROJECT_SWITCHER_WIDTH_STORAGE_KEY]: String(s.projectSwitcherWidth),
    [legacy.RIGHT_SIDEBAR_WIDTH_STORAGE_KEY]: String(s.rightSidebarWidth),
    [legacy.RIGHT_SIDEBAR_SURFACE_STORAGE_KEY]: s.rightSidebarSurface,
    [legacy.HOMEPAGE_PROJECT_LAYOUT_STORAGE_KEY]: s.homepageProjectLayout,
    // A memory, not a setting: nothing is written until something has been moved.
    ...(Object.keys(s.homepageDesktopPositions).length
      ? { [legacy.HOMEPAGE_DESKTOP_POSITIONS_STORAGE_KEY]: JSON.stringify(s.homepageDesktopPositions) } : {}),
    // A memory, not a setting: nothing is written until there is something to
    // remember, so a user who never connected an agent has no key for one.
    ...(s.reachLastAgentId ? { [legacy.REACH_LAST_AGENT_STORAGE_KEY]: s.reachLastAgentId } : {}),
    [legacy.AGENT_ROUTING_PREFERENCES_STORAGE_KEY]: serializeAgentRoutingPreferences(s.agentRoutingPreferences),
  };
}
/** Zustand owns one persist lifecycle. This adapter retains the pre-store wire format. */
export function createPreferencePersistence(storage: PreferenceStorage): PersistStorage<PersistedDesktopPreferences> {
  const saved = new Map<string, string>();
  let readable = true;
  return {
    getItem: () => ({ state: readPreferences(storage, () => { readable = false; }), version: 0 }),
    setItem: (_name, { state }) => {
      // Missing data and inaccessible data are different: never replace unread inputs with defaults.
      if (!readable) return;
      for (const [key, value] of Object.entries(serializePreferences(state))) {
        if (saved.get(key) === value) continue;
        try {
          storage.setItem(key, value);
          if (key === APPEARANCE_PREFERENCES_STORAGE_KEY) removeLegacyAppearancePreferences(storage);
          if (key === legacy.AGENT_ROUTING_PREFERENCES_STORAGE_KEY) {
            storage.removeItem(legacy.AGENT_PREFERRED_RUNTIME_STORAGE_KEY);
            storage.removeItem(legacy.AGENT_PREFERRED_MODEL_STORAGE_KEY);
          }
          saved.set(key, value);
        } catch { /* Keep in-memory edits and migration inputs when storage fails. */ }
      }
      try {
        storage.removeItem("puppyone.desktop.externalApps");
        storage.removeItem(keys.GIT_SIDEBAR_LAYOUT_STORAGE_KEY);
        if (!state.reachLastAgentId) storage.removeItem(legacy.REACH_LAST_AGENT_STORAGE_KEY);
      } catch { /* Storage can be unavailable. */ }
    },
    removeItem: () => {},
  };
}
