import { isFileIconThemeId, type FileIconThemeId } from "@puppyone/shared-ui";
import type { PuppyoneWorkspaceConfig } from "../../types/electron";
import {
  AI_EDIT_ASSIST_STORAGE_KEY,
  DEFAULT_SIDEBAR_NAVIGATION_LAYOUT,
  DEFAULT_THEME_MODE,
  FILES_VISIBILITY_STORAGE_KEY,
  FILE_ICON_THEME_STORAGE_KEY,
  GIT_DISPLAY_MODE_STORAGE_KEY,
  RIGHT_SIDEBAR_TOOLS_STORAGE_KEY,
  SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  parseAiEditAssistEnabled,
  parseFilesVisibilitySettings,
  parseGitDisplayMode,
  parseRightSidebarToolsSettings,
  parseSidebarNavigationLayout,
  parseThemeMode,
  type FilesVisibilitySettings,
  type GitDisplayMode,
  type RightSidebarToolsSettings,
  type SidebarNavigationLayout,
  type ThemeMode,
} from "../../preferences";

export const EXPLORER_WIDTH_STORAGE_KEY = "puppyone.desktop.explorerWidth";
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "puppyone.desktop.sidebarCollapsed";
export const RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = "puppyone.desktop.rightSidebarWidth";
export const DEFAULT_EXPLORER_WIDTH = 320;
export const MIN_EXPLORER_WIDTH = 240;
export const MAX_EXPLORER_WIDTH = 520;
export const COLLAPSED_EXPLORER_WIDTH = 0;
export const DEFAULT_RIGHT_SIDEBAR_WIDTH = 560;
export const MIN_RIGHT_SIDEBAR_WIDTH = 420;
export const MAX_RIGHT_SIDEBAR_WIDTH = 760;
export const TITLEBAR_WORKSPACE_LABEL_CHARS = 12;
export const TITLEBAR_BRANCH_LABEL_CHARS = 24;

export function shortenTitlebarLabel(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 3) return trimmed.slice(0, maxChars);
  return `${trimmed.slice(0, maxChars - 3)}...`;
}

export function readInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_THEME_MODE;
  return parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
}

export function readInitialFileIconTheme(): FileIconThemeId {
  if (typeof window === "undefined") return "default";
  const stored = window.localStorage.getItem(FILE_ICON_THEME_STORAGE_KEY);
  return isFileIconThemeId(stored) ? stored : "default";
}

export function readInitialSidebarNavigationLayout(): SidebarNavigationLayout {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_NAVIGATION_LAYOUT;
  return parseSidebarNavigationLayout(window.localStorage.getItem(SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY));
}

export function readInitialGitDisplayMode(): GitDisplayMode {
  if (typeof window === "undefined") return parseGitDisplayMode(null);
  return parseGitDisplayMode(window.localStorage.getItem(GIT_DISPLAY_MODE_STORAGE_KEY));
}

export function readInitialFilesVisibilitySettings(): FilesVisibilitySettings {
  if (typeof window === "undefined") return parseFilesVisibilitySettings(null);
  return parseFilesVisibilitySettings(window.localStorage.getItem(FILES_VISIBILITY_STORAGE_KEY));
}

export function readInitialRightSidebarToolsSettings(): RightSidebarToolsSettings {
  if (typeof window === "undefined") return parseRightSidebarToolsSettings(null);
  return parseRightSidebarToolsSettings(window.localStorage.getItem(RIGHT_SIDEBAR_TOOLS_STORAGE_KEY));
}

export function mergePuppyoneWorkspaceConfig(
  current: PuppyoneWorkspaceConfig | null,
  patch: Partial<{
    sync: {
      sourceOfTruth: Partial<PuppyoneWorkspaceConfig["sync"]["sourceOfTruth"]>;
    };
    backup: Partial<PuppyoneWorkspaceConfig["backup"]>;
    git: Partial<PuppyoneWorkspaceConfig["git"]>;
    cloud: Partial<PuppyoneWorkspaceConfig["cloud"]>;
  }>,
): PuppyoneWorkspaceConfig {
  const currentSourceOfTruth = current?.sync?.sourceOfTruth;
  const sourceOfTruth = {
    service: currentSourceOfTruth?.service ?? current?.backup?.service ?? "puppyone",
    remote: currentSourceOfTruth?.remote ?? current?.git?.primaryRemote ?? current?.backup?.remote ?? null,
    branch: currentSourceOfTruth?.branch ?? current?.git?.watchedBranch ?? current?.backup?.branch ?? null,
    ...patch.sync?.sourceOfTruth,
  };

  return {
    version: 1,
    sync: {
      sourceOfTruth,
    },
    git: {
      primaryRemote: current?.git?.primaryRemote ?? sourceOfTruth.remote,
      watchedBranch: current?.git?.watchedBranch ?? sourceOfTruth.branch,
      ...patch.git,
    },
    backup: {
      enabled: current?.backup?.enabled ?? false,
      service: current?.backup?.service ?? sourceOfTruth.service,
      remote: current?.backup?.remote ?? sourceOfTruth.remote,
      branch: current?.backup?.branch ?? sourceOfTruth.branch,
      ...patch.backup,
    },
    cloud: {
      projectId: current?.cloud?.projectId ?? null,
      ...patch.cloud,
    },
    ...(current?.updatedAt ? { updatedAt: current.updatedAt } : {}),
  };
}

export function readInitialAiEditAssistEnabled(): boolean {
  if (typeof window === "undefined") return parseAiEditAssistEnabled(null);
  return parseAiEditAssistEnabled(window.localStorage.getItem(AI_EDIT_ASSIST_STORAGE_KEY));
}

export function readInitialExplorerWidth(): number {
  if (typeof window === "undefined") return DEFAULT_EXPLORER_WIDTH;
  const stored = Number(window.localStorage.getItem(EXPLORER_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(stored)) return DEFAULT_EXPLORER_WIDTH;
  return Math.min(Math.max(Math.round(stored), MIN_EXPLORER_WIDTH), MAX_EXPLORER_WIDTH);
}

export function readInitialSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

export function readInitialRightSidebarWidth(): number {
  if (typeof window === "undefined") return DEFAULT_RIGHT_SIDEBAR_WIDTH;
  const stored = Number(window.localStorage.getItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(stored)) return DEFAULT_RIGHT_SIDEBAR_WIDTH;
  return Math.min(Math.max(Math.round(stored), MIN_RIGHT_SIDEBAR_WIDTH), MAX_RIGHT_SIDEBAR_WIDTH);
}

export function readSystemDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
