import type { PuppyoneWorkspaceConfig } from "../../types/electron";
import {
  DEFAULT_EXPLORER_WIDTH,
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  MIN_EXPLORER_WIDTH,
  MIN_RIGHT_SIDEBAR_WIDTH,
} from "./layout/desktopPaneLayout";
import {
  AI_EDIT_ASSIST_STORAGE_KEY,
  AGENT_FILE_ACTIVITY_INDICATORS_STORAGE_KEY,
  CREATE_NEW_MENU_STORAGE_KEY,
  DIFF_MARKERS_STORAGE_KEY,
  EXPERIMENTAL_SETTINGS_STORAGE_KEY,
  FILES_VISIBILITY_STORAGE_KEY,
  GIT_DISPLAY_MODE_STORAGE_KEY,
  GIT_SIDEBAR_LAYOUT_STORAGE_KEY,
  LOCAL_AGENTS_STORAGE_KEY,
  RIGHT_SIDEBAR_TOOLS_STORAGE_KEY,
  SIDEBAR_NAVIGATION_VISIBILITY_STORAGE_KEY,
  TITLEBAR_ACTIONS_STORAGE_KEY,
  parseAiEditAssistEnabled,
  parseAgentFileActivityIndicatorsEnabled,
  parseCreateNewMenuSettings,
  parseDiffMarkers,
  parseExperimentalSettings,
  parseFilesVisibilitySettings,
  parseGitDisplayMode,
  parseGitSidebarLayout,
  parseLocalAgentsSettings,
  parseRightSidebarToolsSettings,
  parseSidebarNavigationVisibilitySettings,
  parseTitlebarActionsSettings,
  type CreateNewMenuSettings,
  type DiffMarkers,
  type ExperimentalSettings,
  type FilesVisibilitySettings,
  type GitDisplayMode,
  type GitSidebarLayout,
  type LocalAgentsSettings,
  type RightSidebarToolsSettings,
  type SidebarNavigationVisibilitySettings,
  type TitlebarActionsSettings,
} from "../../preferences";

export const EXPLORER_WIDTH_STORAGE_KEY = "puppyone.desktop.explorerWidth";
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "puppyone.desktop.sidebarCollapsed";
export const RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = "puppyone.desktop.rightSidebarWidth";
export const RIGHT_SIDEBAR_SURFACE_STORAGE_KEY = "puppyone.desktop.rightSidebarSurface";
export const AGENT_ROUTING_PREFERENCES_STORAGE_KEY = "puppyone.desktop.agentRoutingPreferences.v1";
/** @deprecated Migrated into AGENT_ROUTING_PREFERENCES_STORAGE_KEY. */
export const AGENT_PREFERRED_RUNTIME_STORAGE_KEY = "puppyone.desktop.agentPreferredRuntime";
/** @deprecated Migrated into AGENT_ROUTING_PREFERENCES_STORAGE_KEY. */
export const AGENT_PREFERRED_MODEL_STORAGE_KEY = "puppyone.desktop.agentPreferredModel";
export type RightSidebarSurface = "chat" | "terminal";

export function readInitialDiffMarkers(): DiffMarkers {
  if (typeof window === "undefined") return parseDiffMarkers(null);
  return parseDiffMarkers(window.localStorage.getItem(DIFF_MARKERS_STORAGE_KEY));
}

export function readInitialSidebarNavigationVisibilitySettings(): SidebarNavigationVisibilitySettings {
  if (typeof window === "undefined") return parseSidebarNavigationVisibilitySettings(null);
  return parseSidebarNavigationVisibilitySettings(
    window.localStorage.getItem(SIDEBAR_NAVIGATION_VISIBILITY_STORAGE_KEY),
  );
}

export function readInitialGitDisplayMode(): GitDisplayMode {
  if (typeof window === "undefined") return parseGitDisplayMode(null);
  return parseGitDisplayMode(window.localStorage.getItem(GIT_DISPLAY_MODE_STORAGE_KEY));
}

export function readInitialGitSidebarLayout(): GitSidebarLayout {
  if (typeof window === "undefined") return parseGitSidebarLayout(null);
  return parseGitSidebarLayout(window.localStorage.getItem(GIT_SIDEBAR_LAYOUT_STORAGE_KEY));
}

export function readInitialFilesVisibilitySettings(): FilesVisibilitySettings {
  if (typeof window === "undefined") return parseFilesVisibilitySettings(null);
  return parseFilesVisibilitySettings(window.localStorage.getItem(FILES_VISIBILITY_STORAGE_KEY));
}

export function readInitialCreateNewMenuSettings(): CreateNewMenuSettings {
  if (typeof window === "undefined") return parseCreateNewMenuSettings(null);
  return parseCreateNewMenuSettings(window.localStorage.getItem(CREATE_NEW_MENU_STORAGE_KEY));
}

export function readInitialRightSidebarToolsSettings(): RightSidebarToolsSettings {
  if (typeof window === "undefined") return parseRightSidebarToolsSettings(null);
  return parseRightSidebarToolsSettings(window.localStorage.getItem(RIGHT_SIDEBAR_TOOLS_STORAGE_KEY));
}

export function readInitialTitlebarActionsSettings(): TitlebarActionsSettings {
  if (typeof window === "undefined") return parseTitlebarActionsSettings(null);
  return parseTitlebarActionsSettings(window.localStorage.getItem(TITLEBAR_ACTIONS_STORAGE_KEY));
}

export function readInitialLocalAgentsSettings(): LocalAgentsSettings {
  if (typeof window === "undefined") return parseLocalAgentsSettings(null);
  return parseLocalAgentsSettings(window.localStorage.getItem(LOCAL_AGENTS_STORAGE_KEY));
}

export function readInitialAgentFileActivityIndicatorsEnabled(): boolean {
  if (typeof window === "undefined") return parseAgentFileActivityIndicatorsEnabled(null);
  return parseAgentFileActivityIndicatorsEnabled(
    window.localStorage.getItem(AGENT_FILE_ACTIVITY_INDICATORS_STORAGE_KEY),
  );
}

export function mergePuppyoneWorkspaceConfig(
  current: PuppyoneWorkspaceConfig | null,
  patch: Partial<{
    sync: {
      sourceOfTruth: Partial<PuppyoneWorkspaceConfig["sync"]["sourceOfTruth"]>;
    };
    backup: Partial<PuppyoneWorkspaceConfig["backup"]>;
    git: Partial<PuppyoneWorkspaceConfig["git"]>;
  }>,
): PuppyoneWorkspaceConfig {
  const currentSourceOfTruth = current?.sync?.sourceOfTruth;
  const sourceOfTruth = {
    service: currentSourceOfTruth?.service ?? current?.backup?.service ?? "github",
    remote: currentSourceOfTruth?.remote ?? current?.git?.primaryRemote ?? current?.backup?.remote ?? null,
    branch: currentSourceOfTruth?.branch ?? current?.git?.watchedBranch ?? current?.backup?.branch ?? null,
    ...patch.sync?.sourceOfTruth,
  };
  if (sourceOfTruth.service === "puppyone") {
    sourceOfTruth.branch = null;
  }

  const git = {
    primaryRemote: current?.git?.primaryRemote ?? sourceOfTruth.remote,
    watchedBranch: current?.git?.watchedBranch ?? sourceOfTruth.branch,
    ...patch.git,
  };
  if (sourceOfTruth.service === "puppyone") {
    git.watchedBranch = null;
  }

  const backup = {
    enabled: current?.backup?.enabled ?? false,
    service: current?.backup?.service ?? sourceOfTruth.service,
    remote: current?.backup?.remote ?? sourceOfTruth.remote,
    branch: current?.backup?.branch ?? sourceOfTruth.branch,
    ...patch.backup,
  };
  if (backup.service === "puppyone") {
    backup.branch = null;
  }

  return {
    version: 3,
    sync: {
      sourceOfTruth,
    },
    git,
    backup,
    ...(current?.updatedAt ? { updatedAt: current.updatedAt } : {}),
  };
}

export function readInitialAiEditAssistEnabled(): boolean {
  if (typeof window === "undefined") return parseAiEditAssistEnabled(null);
  return parseAiEditAssistEnabled(window.localStorage.getItem(AI_EDIT_ASSIST_STORAGE_KEY));
}

export function readInitialExperimentalSettings(): ExperimentalSettings {
  if (typeof window === "undefined") return parseExperimentalSettings(null);
  return parseExperimentalSettings(window.localStorage.getItem(EXPERIMENTAL_SETTINGS_STORAGE_KEY));
}

export function readInitialExplorerWidth(): number {
  if (typeof window === "undefined") return DEFAULT_EXPLORER_WIDTH;
  const storedValue = window.localStorage.getItem(EXPLORER_WIDTH_STORAGE_KEY);
  if (storedValue === null) return DEFAULT_EXPLORER_WIDTH;
  const stored = Number(storedValue);
  if (!Number.isFinite(stored)) return DEFAULT_EXPLORER_WIDTH;
  return Math.max(Math.round(stored), MIN_EXPLORER_WIDTH);
}

export function readInitialSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

export function readInitialRightSidebarWidth(): number {
  if (typeof window === "undefined") return DEFAULT_RIGHT_SIDEBAR_WIDTH;
  const storedValue = window.localStorage.getItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY);
  if (storedValue === null) return DEFAULT_RIGHT_SIDEBAR_WIDTH;
  const stored = Number(storedValue);
  if (!Number.isFinite(stored)) return DEFAULT_RIGHT_SIDEBAR_WIDTH;
  return Math.max(Math.round(stored), MIN_RIGHT_SIDEBAR_WIDTH);
}

export function readInitialRightSidebarSurface(): RightSidebarSurface {
  if (typeof window === "undefined") return "terminal";
  return window.localStorage.getItem(RIGHT_SIDEBAR_SURFACE_STORAGE_KEY) === "chat" ? "chat" : "terminal";
}

export function readInitialAgentPreferredModel(): string | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(AGENT_PREFERRED_MODEL_STORAGE_KEY);
  return typeof stored === "string" && stored.trim().length > 0 ? stored.trim().slice(0, 200) : null;
}

export function readInitialAgentPreferredRuntime(): string | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(AGENT_PREFERRED_RUNTIME_STORAGE_KEY)?.trim() ?? "";
  return /^[a-z][a-z0-9-]{1,39}$/.test(stored) ? stored : null;
}

export function readSystemDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
