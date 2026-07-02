import { useEffect, useState } from "react";
import type { FileIconThemeId } from "@puppyone/shared-ui";
import {
  AI_EDIT_ASSIST_STORAGE_KEY,
  FILES_VISIBILITY_STORAGE_KEY,
  FILE_ICON_THEME_STORAGE_KEY,
  GIT_DISPLAY_MODE_STORAGE_KEY,
  RIGHT_SIDEBAR_TOOLS_STORAGE_KEY,
  SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  getSidebarNavigationOrientation,
  getSidebarNavigationPlacement,
  type FilesVisibilitySettings,
  type GitDisplayMode,
  type RightSidebarToolsSettings,
  type SidebarNavigationLayout,
  type ThemeMode,
} from "../../preferences";
import {
  EXPLORER_WIDTH_STORAGE_KEY,
  RIGHT_SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  readInitialAiEditAssistEnabled,
  readInitialExplorerWidth,
  readInitialFileIconTheme,
  readInitialFilesVisibilitySettings,
  readInitialGitDisplayMode,
  readInitialRightSidebarToolsSettings,
  readInitialRightSidebarWidth,
  readInitialSidebarCollapsed,
  readInitialSidebarNavigationLayout,
  readInitialThemeMode,
  readSystemDarkMode,
} from "./preferences";

export function useDesktopPreferences() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readInitialThemeMode());
  const [fileIconTheme, setFileIconTheme] = useState<FileIconThemeId>(() => readInitialFileIconTheme());
  const [sidebarNavigationLayout, setSidebarNavigationLayout] = useState<SidebarNavigationLayout>(() => readInitialSidebarNavigationLayout());
  const [gitDisplayMode, setGitDisplayMode] = useState<GitDisplayMode>(() => readInitialGitDisplayMode());
  const [filesVisibilitySettings, setFilesVisibilitySettings] = useState<FilesVisibilitySettings>(() => readInitialFilesVisibilitySettings());
  const [rightSidebarToolsSettings, setRightSidebarToolsSettings] = useState<RightSidebarToolsSettings>(() => readInitialRightSidebarToolsSettings());
  const [aiEditAssistEnabled, setAiEditAssistEnabled] = useState(() => readInitialAiEditAssistEnabled());
  const [explorerWidth, setExplorerWidth] = useState(() => readInitialExplorerWidth());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readInitialSidebarCollapsed());
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => readInitialRightSidebarWidth());
  const [systemDark, setSystemDark] = useState(() => readSystemDarkMode());

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    window.localStorage.setItem(FILE_ICON_THEME_STORAGE_KEY, fileIconTheme);
  }, [fileIconTheme]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY, sidebarNavigationLayout);
  }, [sidebarNavigationLayout]);

  useEffect(() => {
    window.localStorage.setItem(GIT_DISPLAY_MODE_STORAGE_KEY, gitDisplayMode);
  }, [gitDisplayMode]);

  useEffect(() => {
    window.localStorage.setItem(FILES_VISIBILITY_STORAGE_KEY, JSON.stringify(filesVisibilitySettings));
  }, [filesVisibilitySettings]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_SIDEBAR_TOOLS_STORAGE_KEY, JSON.stringify(rightSidebarToolsSettings));
  }, [rightSidebarToolsSettings]);

  useEffect(() => {
    window.localStorage.setItem(AI_EDIT_ASSIST_STORAGE_KEY, aiEditAssistEnabled ? "true" : "false");
  }, [aiEditAssistEnabled]);

  useEffect(() => {
    window.localStorage.setItem(EXPLORER_WIDTH_STORAGE_KEY, String(explorerWidth));
  }, [explorerWidth]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? "true" : "false");
  }, [sidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const resolvedTheme = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;
  const sidebarNavigationPlacement = getSidebarNavigationPlacement(sidebarNavigationLayout);
  const sidebarNavigationOrientation = getSidebarNavigationOrientation(sidebarNavigationLayout);
  const terminalToolEnabled = rightSidebarToolsSettings.enabled.terminal;
  const terminalSidebarOpen = terminalToolEnabled && rightSidebarOpen;

  useEffect(() => {
    if (!terminalToolEnabled && rightSidebarOpen) setRightSidebarOpen(false);
  }, [rightSidebarOpen, terminalToolEnabled]);

  return {
    aiEditAssistEnabled,
    explorerWidth,
    fileIconTheme,
    filesVisibilitySettings,
    gitDisplayMode,
    resolvedTheme,
    rightSidebarOpen,
    rightSidebarToolsSettings,
    rightSidebarWidth,
    sidebarCollapsed,
    sidebarNavigationLayout,
    sidebarNavigationOrientation,
    sidebarNavigationPlacement,
    terminalSidebarOpen,
    terminalToolEnabled,
    themeMode,
    setAiEditAssistEnabled,
    setExplorerWidth,
    setFileIconTheme,
    setFilesVisibilitySettings,
    setGitDisplayMode,
    setRightSidebarOpen,
    setRightSidebarToolsSettings,
    setRightSidebarWidth,
    setSidebarCollapsed,
    setSidebarNavigationLayout,
    setThemeMode,
  };
}

export type DesktopPreferencesController = ReturnType<typeof useDesktopPreferences>;
