import {
DEFAULT_EXPLORER_WIDTH,
DEFAULT_RIGHT_SIDEBAR_WIDTH,
MIN_EXPLORER_WIDTH,
MIN_RIGHT_SIDEBAR_WIDTH,
} from "./lib/desktopPaneLayout";
import {
clampProjectSwitcherExpandedWidth,
DEFAULT_PROJECT_SWITCHER_EXPANDED_WIDTH,
} from "./features/app-shell/projectSwitcherRailGeometry";
import {
AGENT_FILE_ACTIVITY_INDICATORS_STORAGE_KEY,
AI_EDIT_ASSIST_STORAGE_KEY,
CREATE_NEW_MENU_STORAGE_KEY,
DIFF_MARKERS_STORAGE_KEY,
EXPERIMENTAL_SETTINGS_STORAGE_KEY,
FILES_VISIBILITY_STORAGE_KEY,
GIT_DISPLAY_MODE_STORAGE_KEY,
LOCAL_AGENTS_STORAGE_KEY,
parseAgentFileActivityIndicatorsEnabled,
parseAiEditAssistEnabled,
parseCreateNewMenuSettings,
parseDiffMarkers,
parseExperimentalSettings,
parseFilesVisibilitySettings,
parseGitDisplayMode,
parseLocalAgentsSettings,
parseRightSidebarToolsSettings,
parseTitlebarActionsSettings,
RIGHT_SIDEBAR_TOOLS_STORAGE_KEY,
TITLEBAR_ACTIONS_STORAGE_KEY,
type CreateNewMenuSettings,
type DiffMarkers,
type ExperimentalSettings,
type FilesVisibilitySettings,
type GitDisplayMode,
type LocalAgentsSettings,
type RightSidebarToolsSettings,
type TitlebarActionsSettings,
} from "./preferences";

export const EXPLORER_WIDTH_STORAGE_KEY = "puppyone.desktop.explorerWidth";
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "puppyone.desktop.sidebarCollapsed";
export const PROJECT_SWITCHER_EXPANDED_STORAGE_KEY = "puppyone.desktop.projectSwitcherExpanded";
export const PROJECT_SWITCHER_WIDTH_STORAGE_KEY = "puppyone.desktop.projectSwitcherWidth";
export const RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = "puppyone.desktop.rightSidebarWidth";
export const RIGHT_SIDEBAR_SURFACE_STORAGE_KEY = "puppyone.desktop.rightSidebarSurface";
export const HOMEPAGE_PROJECT_LAYOUT_STORAGE_KEY = "puppyone.desktop.homepageProjectLayout";
export const HOMEPAGE_PROJECT_SORT_STORAGE_KEY = "puppyone.desktop.homepageProjectSort";
export const AGENT_ROUTING_PREFERENCES_STORAGE_KEY = "puppyone.desktop.agentRoutingPreferences.v1";
export const REACH_LAST_AGENT_STORAGE_KEY = "puppyone.desktop.reachLastAgent";
/** @deprecated Migrated into AGENT_ROUTING_PREFERENCES_STORAGE_KEY. */
export const AGENT_PREFERRED_RUNTIME_STORAGE_KEY = "puppyone.desktop.agentPreferredRuntime";
/** @deprecated Migrated into AGENT_ROUTING_PREFERENCES_STORAGE_KEY. */
export const AGENT_PREFERRED_MODEL_STORAGE_KEY = "puppyone.desktop.agentPreferredModel";
export type RightSidebarSurface = "chat" | "changes" | "history";
export const HOMEPAGE_PROJECT_LAYOUTS = ["list", "grid"] as const;
export type HomepageProjectLayout = typeof HOMEPAGE_PROJECT_LAYOUTS[number];
export const HOMEPAGE_PROJECT_SORTS = ["modified", "name"] as const;
export type HomepageProjectSort = typeof HOMEPAGE_PROJECT_SORTS[number];

export function readInitialDiffMarkers(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): DiffMarkers {
  if (typeof window === "undefined") return parseDiffMarkers(null);
  return parseDiffMarkers(storage.getItem(DIFF_MARKERS_STORAGE_KEY));
}

export function readInitialGitDisplayMode(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): GitDisplayMode {
  if (typeof window === "undefined") return parseGitDisplayMode(null);
  return parseGitDisplayMode(storage.getItem(GIT_DISPLAY_MODE_STORAGE_KEY));
}

export function readInitialFilesVisibilitySettings(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): FilesVisibilitySettings {
  if (typeof window === "undefined") return parseFilesVisibilitySettings(null);
  return parseFilesVisibilitySettings(storage.getItem(FILES_VISIBILITY_STORAGE_KEY));
}

export function readInitialCreateNewMenuSettings(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): CreateNewMenuSettings {
  if (typeof window === "undefined") return parseCreateNewMenuSettings(null);
  return parseCreateNewMenuSettings(storage.getItem(CREATE_NEW_MENU_STORAGE_KEY));
}

export function readInitialRightSidebarToolsSettings(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): RightSidebarToolsSettings {
  if (typeof window === "undefined") return parseRightSidebarToolsSettings(null);
  return parseRightSidebarToolsSettings(storage.getItem(RIGHT_SIDEBAR_TOOLS_STORAGE_KEY));
}

export function readInitialTitlebarActionsSettings(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): TitlebarActionsSettings {
  if (typeof window === "undefined") return parseTitlebarActionsSettings(null);
  return parseTitlebarActionsSettings(storage.getItem(TITLEBAR_ACTIONS_STORAGE_KEY));
}

export function readInitialLocalAgentsSettings(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): LocalAgentsSettings {
  if (typeof window === "undefined") return parseLocalAgentsSettings(null);
  return parseLocalAgentsSettings(storage.getItem(LOCAL_AGENTS_STORAGE_KEY));
}

export function readInitialAgentFileActivityIndicatorsEnabled(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): boolean {
  if (typeof window === "undefined") return parseAgentFileActivityIndicatorsEnabled(null);
  return parseAgentFileActivityIndicatorsEnabled(
    storage.getItem(AGENT_FILE_ACTIVITY_INDICATORS_STORAGE_KEY),
  );
}

export function readInitialAiEditAssistEnabled(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): boolean {
  if (typeof window === "undefined") return parseAiEditAssistEnabled(null);
  return parseAiEditAssistEnabled(storage.getItem(AI_EDIT_ASSIST_STORAGE_KEY));
}

export function readInitialExperimentalSettings(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): ExperimentalSettings {
  if (typeof window === "undefined") return parseExperimentalSettings(null);
  return parseExperimentalSettings(storage.getItem(EXPERIMENTAL_SETTINGS_STORAGE_KEY));
}

export function readInitialExplorerWidth(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): number {
  if (typeof window === "undefined") return DEFAULT_EXPLORER_WIDTH;
  const storedValue = storage.getItem(EXPLORER_WIDTH_STORAGE_KEY);
  if (storedValue === null) return DEFAULT_EXPLORER_WIDTH;
  const stored = Number(storedValue);
  if (!Number.isFinite(stored)) return DEFAULT_EXPLORER_WIDTH;
  return Math.max(Math.round(stored), MIN_EXPLORER_WIDTH);
}

export function readInitialSidebarCollapsed(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): boolean {
  if (typeof window === "undefined") return false;
  return storage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

export function readInitialProjectSwitcherExpanded(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): boolean {
  if (typeof window === "undefined") return false;
  return storage.getItem(PROJECT_SWITCHER_EXPANDED_STORAGE_KEY) === "true";
}

export function readInitialProjectSwitcherWidth(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): number {
  if (typeof window === "undefined") return DEFAULT_PROJECT_SWITCHER_EXPANDED_WIDTH;
  const storedValue = storage.getItem(PROJECT_SWITCHER_WIDTH_STORAGE_KEY);
  if (storedValue === null) return DEFAULT_PROJECT_SWITCHER_EXPANDED_WIDTH;
  return clampProjectSwitcherExpandedWidth(Number(storedValue));
}

export function readInitialRightSidebarWidth(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): number {
  if (typeof window === "undefined") return DEFAULT_RIGHT_SIDEBAR_WIDTH;
  const storedValue = storage.getItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY);
  if (storedValue === null) return DEFAULT_RIGHT_SIDEBAR_WIDTH;
  const stored = Number(storedValue);
  if (!Number.isFinite(stored)) return DEFAULT_RIGHT_SIDEBAR_WIDTH;
  return Math.max(Math.round(stored), MIN_RIGHT_SIDEBAR_WIDTH);
}

export function readInitialRightSidebarSurface(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): RightSidebarSurface {
  if (typeof window === "undefined") return "chat";
  const stored = storage.getItem(RIGHT_SIDEBAR_SURFACE_STORAGE_KEY);
  return stored === "history" || stored === "changes" ? stored : "chat";
}

export function readInitialHomepageProjectLayout(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): HomepageProjectLayout {
  if (typeof window === "undefined") return "grid";
  const stored = storage.getItem(HOMEPAGE_PROJECT_LAYOUT_STORAGE_KEY);
  return HOMEPAGE_PROJECT_LAYOUTS.find((layout) => layout === stored) ?? "grid";
}

export function readInitialHomepageProjectSort(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): HomepageProjectSort {
  if (typeof window === "undefined") return "modified";
  const stored = storage.getItem(HOMEPAGE_PROJECT_SORT_STORAGE_KEY);
  return HOMEPAGE_PROJECT_SORTS.find((sort) => sort === stored) ?? "modified";
}

export function readInitialAgentPreferredModel(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): string | null {
  if (typeof window === "undefined") return null;
  const stored = storage.getItem(AGENT_PREFERRED_MODEL_STORAGE_KEY);
  return typeof stored === "string" && stored.trim().length > 0 ? stored.trim().slice(0, 200) : null;
}

export function readInitialAgentPreferredRuntime(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): string | null {
  if (typeof window === "undefined") return null;
  const stored = storage.getItem(AGENT_PREFERRED_RUNTIME_STORAGE_KEY)?.trim() ?? "";
  return /^[a-z][a-z0-9-]{1,39}$/.test(stored) ? stored : null;
}

/**
 * The destination a project was last connected to. Stored as its id alone:
 * what that id names is decided by the share model at read time, so a
 * destination the product no longer offers is simply forgotten.
 */
export function readInitialReachLastAgent(storage: Pick<Storage, "getItem"> = defaultPreferenceStorage()): string | null {
  if (typeof window === "undefined") return null;
  const stored = storage.getItem(REACH_LAST_AGENT_STORAGE_KEY)?.trim() ?? "";
  return /^[a-z][a-z0-9-]{1,39}$/.test(stored) ? stored : null;
}

export function readSystemDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function defaultPreferenceStorage(): Pick<Storage, "getItem"> {
  return typeof window === "undefined" ? { getItem: () => null } : window.localStorage;
}
