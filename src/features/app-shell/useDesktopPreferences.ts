import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { FileIconThemeId } from "@puppyone/shared-ui";
import {
  getDefaultSubThemeId,
  getInterfaceStyleFirstPaint,
  supportsThemePreset,
} from "../appearance/interfaceStyles";
import {
  APPEARANCE_PREFERENCES_STORAGE_KEY,
  createAppearancePreferencesV6,
  readAppearancePreferences,
  serializeAppearancePreferences,
  type RootThemeAppearancePreferences,
} from "../appearance/appearancePreferences";
import {
  readLegacyAppearanceDocument,
  readLegacyAppearanceSnapshot,
  removeLegacyAppearancePreferences,
} from "../appearance/legacyAppearancePreferences";
import { resolveAppearance } from "../appearance/resolveAppearance";
import { BUILTIN_SUB_THEMES } from "../themes/builtinSubThemes";
import type { SubThemeCatalogSnapshot } from "../themes/themeTypes";
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
  parseCreateNewMenuSettings,
  type CreateNewMenuSettings,
  type DiffMarkers,
  type ExperimentalSettings,
  type FilesVisibilitySettings,
  type GitDisplayMode,
  type GitSidebarLayout,
  type InterfaceStyle,
  type LoadingAnimationPreset,
  type LocalAgentsSettings,
  type RightSidebarToolsSettings,
  type SidebarNavigationLayout,
  type SidebarNavigationVisibilitySettings,
  type ThemeMode,
  type TypographyPreferences,
  type TitlebarActionsSettings,
} from "../../preferences";
import type { MarkdownPresentationSettings } from "../markdown/markdownPresentation";
import {
  AGENT_ROUTING_PREFERENCES_STORAGE_KEY,
  AGENT_PREFERRED_RUNTIME_STORAGE_KEY,
  AGENT_PREFERRED_MODEL_STORAGE_KEY,
  EXPLORER_WIDTH_STORAGE_KEY,
  PROJECT_SWITCHER_EXPANDED_STORAGE_KEY,
  PROJECT_SWITCHER_WIDTH_STORAGE_KEY,
  RIGHT_SIDEBAR_WIDTH_STORAGE_KEY,
  RIGHT_SIDEBAR_SURFACE_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  readInitialAgentPreferredModel,
  readInitialAgentPreferredRuntime,
  readInitialAgentFileActivityIndicatorsEnabled,
  readInitialAiEditAssistEnabled,
  readInitialCreateNewMenuSettings,
  readInitialExperimentalSettings,
  readInitialExplorerWidth,
  readInitialProjectSwitcherExpanded,
  readInitialProjectSwitcherWidth,
  readInitialFilesVisibilitySettings,
  readInitialGitDisplayMode,
  readInitialGitSidebarLayout,
  readInitialRightSidebarToolsSettings,
  readInitialRightSidebarWidth,
  readInitialRightSidebarSurface,
  readInitialSidebarCollapsed,
  readInitialSidebarNavigationVisibilitySettings,
  readInitialTitlebarActionsSettings,
  readInitialDiffMarkers,
  readInitialLocalAgentsSettings,
  readSystemDarkMode,
} from "./preferences";
import {
  parseAgentRoutingPreferences,
  selectAgentRuntime,
  serializeAgentRoutingPreferences,
  updateAgentRoutePreference,
  type AgentRoutePreference,
} from "./agentRoutingPreferences";

const BUILTIN_SUB_THEME_CATALOG: SubThemeCatalogSnapshot = Object.freeze({
  subThemes: BUILTIN_SUB_THEMES,
  diagnostics: Object.freeze([]),
});

export function useDesktopPreferences(
  subThemeCatalog: SubThemeCatalogSnapshot = BUILTIN_SUB_THEME_CATALOG,
) {
  const [initialAppearanceRead] = useState(() => {
    const legacy = readLegacyAppearanceSnapshot();
    return readAppearancePreferences(
      window.localStorage.getItem(APPEARANCE_PREFERENCES_STORAGE_KEY)
        ?? readLegacyAppearanceDocument(),
      legacy,
    );
  });
  const initialAppearance = initialAppearanceRead.preferences;
  const [interfaceStyle, setInterfaceStyle] = useState<InterfaceStyle>(
    initialAppearance.activeRootThemeId,
  );
  const [byRootTheme, setByRootTheme] = useState(initialAppearance.byRootTheme);
  const rootThemePreference = byRootTheme[interfaceStyle]
    ?? createDefaultRootThemePreference(interfaceStyle);
  const themeMode = rootThemePreference.requestedColorMode;
  const requestedSubThemeIds = rootThemePreference.requestedSubThemeIds;
  const [typographyPreferences, setTypographyPreferences] = useState<TypographyPreferences>(
    initialAppearance.shared.typography,
  );
  const [pointerCursors, setPointerCursors] = useState(initialAppearance.shared.pointerCursors);
  const [loadingAnimationPreset, setLoadingAnimationPreset] = useState<LoadingAnimationPreset>(
    initialAppearance.shared.loadingAnimationPreset,
  );
  const [diffMarkers, setDiffMarkers] = useState<DiffMarkers>(() => readInitialDiffMarkers());
  const [markdownPresentation, setMarkdownPresentation] = useState<MarkdownPresentationSettings>(
    initialAppearance.bySurface.markdown,
  );
  const [fileIconTheme, setFileIconTheme] = useState<FileIconThemeId>(initialAppearance.shared.fileIconTheme);
  const [sidebarNavigationLayout, setSidebarNavigationLayout] = useState<SidebarNavigationLayout>(
    initialAppearance.shared.sidebarNavigationLayout,
  );
  const [sidebarNavigationVisibilitySettings, setSidebarNavigationVisibilitySettings] = useState<SidebarNavigationVisibilitySettings>(
    () => readInitialSidebarNavigationVisibilitySettings(),
  );
  const [gitDisplayMode, setGitDisplayMode] = useState<GitDisplayMode>(() => readInitialGitDisplayMode());
  const [gitSidebarLayout, setGitSidebarLayout] = useState<GitSidebarLayout>(() => readInitialGitSidebarLayout());
  const [filesVisibilitySettings, setFilesVisibilitySettings] = useState<FilesVisibilitySettings>(() => readInitialFilesVisibilitySettings());
  const [createNewMenuSettings, setCreateNewMenuSettings] = useState<CreateNewMenuSettings>(
    () => readInitialCreateNewMenuSettings(),
  );
  const [experimentalSettings, setExperimentalSettingsState] = useState<ExperimentalSettings>(() => readInitialExperimentalSettings());
  const [rightSidebarToolsSettings, setRightSidebarToolsSettings] = useState<RightSidebarToolsSettings>(() => readInitialRightSidebarToolsSettings());
  const [titlebarActionsSettings, setTitlebarActionsSettings] = useState<TitlebarActionsSettings>(() => readInitialTitlebarActionsSettings());
  const [localAgentsSettings, setLocalAgentsSettings] = useState<LocalAgentsSettings>(
    () => readInitialLocalAgentsSettings(),
  );
  const [agentFileActivityIndicatorsEnabled, setAgentFileActivityIndicatorsEnabled] = useState(
    () => readInitialAgentFileActivityIndicatorsEnabled(),
  );
  const [aiEditAssistEnabled, setAiEditAssistEnabled] = useState(() => readInitialAiEditAssistEnabled());
  const [explorerWidth, setExplorerWidth] = useState(() => readInitialExplorerWidth());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readInitialSidebarCollapsed());
  const [projectSwitcherExpanded, setProjectSwitcherExpanded] = useState(
    () => readInitialProjectSwitcherExpanded(),
  );
  const [projectSwitcherWidth, setProjectSwitcherWidth] = useState(
    () => readInitialProjectSwitcherWidth(),
  );
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => readInitialRightSidebarWidth());
  const [rightSidebarSurface, setRightSidebarSurface] = useState(() => readInitialRightSidebarSurface());
  const [agentRoutingPreferences, setAgentRoutingPreferences] = useState(() => (
    parseAgentRoutingPreferences(
      window.localStorage.getItem(AGENT_ROUTING_PREFERENCES_STORAGE_KEY),
      {
        legacyRuntimeId: readInitialAgentPreferredRuntime(),
        legacyModelId: readInitialAgentPreferredModel(),
      },
    )
  ));
  const agentPreferredRuntime = agentRoutingPreferences.selectedRuntimeId;
  const agentPreferredRoute = agentPreferredRuntime
    ? agentRoutingPreferences.routes[agentPreferredRuntime] ?? {}
    : {};
  const agentPreferredModel = agentPreferredRoute.modelId ?? null;
  const setAgentPreferredRuntime = useCallback((runtimeId: string | null) => {
    setAgentRoutingPreferences((current) => selectAgentRuntime(current, runtimeId));
  }, []);
  const setAgentPreferredRoute = useCallback((patch: Partial<AgentRoutePreference>) => {
    setAgentRoutingPreferences((current) => (
      current.selectedRuntimeId
        ? updateAgentRoutePreference(current, current.selectedRuntimeId, patch)
        : current
    ));
  }, []);
  const setAgentPreferredModel = useCallback((modelId: string | null) => {
    setAgentPreferredRoute({ modelId: modelId ?? undefined });
  }, [setAgentPreferredRoute]);
  const [systemDark, setSystemDark] = useState(() => readSystemDarkMode());
  const resolvedAppearance = useMemo(() => resolveAppearance({
    interfaceStyle,
    themeMode,
    systemColorMode: systemDark ? "dark" : "light",
    requestedSubThemeIds,
    subThemeCatalog,
    sidebarNavigationLayout,
    fileIconTheme,
  }), [
    fileIconTheme,
    interfaceStyle,
    requestedSubThemeIds,
    sidebarNavigationLayout,
    subThemeCatalog,
    systemDark,
    themeMode,
  ]);
  const activeThemeMode = resolvedAppearance.themeMode;
  const resolvedTheme = resolvedAppearance.effectiveColorMode;
  const requestedSubThemeId = requestedSubThemeIds[resolvedTheme];
  const lightSubTheme = subThemeCatalog.subThemes.find(
    (subTheme) => subTheme.id === requestedSubThemeIds.light,
  );
  const darkSubTheme = subThemeCatalog.subThemes.find(
    (subTheme) => subTheme.id === requestedSubThemeIds.dark,
  );
  const lightThemePreset = lightSubTheme?.legacyPresets?.light ?? "neutral";
  const darkThemePreset = darkSubTheme?.legacyPresets?.dark ?? "default";
  const activeThemePreset = resolvedAppearance.legacyThemePreset;
  const setThemeMode = useCallback((requestedColorMode: ThemeMode) => {
    setByRootTheme((current) => updateRootThemePreference(
      current,
      interfaceStyle,
      { requestedColorMode },
    ));
  }, [interfaceStyle]);
  const setSubThemeId = useCallback((subThemeId: string) => {
    setByRootTheme((current) => updateRootThemeSubTheme(
      current,
      interfaceStyle,
      resolvedAppearance.effectiveColorMode,
      subThemeId,
    ));
  }, [interfaceStyle, resolvedAppearance.effectiveColorMode]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const firstPaint = getInterfaceStyleFirstPaint(
      interfaceStyle,
      resolvedTheme,
      resolvedAppearance.subTheme,
    );
    root.dataset.interfaceStyle = interfaceStyle;
    root.dataset.interfaceStyleFamily = resolvedAppearance.profile.family;
    root.dataset.interfaceStyleVariant = resolvedAppearance.profile.variant;
    root.dataset.interfaceStylePalette = resolvedAppearance.profile.palette;
    root.dataset.appearanceTokenSet = resolvedAppearance.tokenSet;
    root.dataset.shellComposition = resolvedAppearance.composition.shell;
    root.dataset.titlebarComposition = resolvedAppearance.composition.titlebar;
    root.dataset.navigationComposition = resolvedAppearance.composition.navigation;
    root.dataset.locationBarComposition = resolvedAppearance.composition.locationBar;
    root.dataset.scrollbarComposition = resolvedAppearance.composition.scrollbar;
    root.dataset.iconPack = resolvedAppearance.composition.iconPack;
    root.dataset.initialTheme = resolvedTheme;
    if (supportsThemePreset(interfaceStyle, resolvedTheme)) {
      root.dataset.initialThemePreset = activeThemePreset;
    } else {
      delete root.dataset.initialThemePreset;
    }
    root.style.setProperty("--initial-shell-background", firstPaint.background);
    root.style.setProperty("--initial-shell-color-scheme", firstPaint.colorScheme);
    const titlebar = document.querySelector<HTMLElement>(".desktop-titlebar");
    const titlebarBackground = titlebar
      ? window.getComputedStyle(titlebar).backgroundColor
      : undefined;
    window.puppyoneDesktop?.setWindowBackground?.({
      background: firstPaint.background,
      titlebarBackground,
      themeSource: activeThemeMode === "system" ? "system" : firstPaint.colorScheme,
    });
    void window.puppyoneDesktop?.setWindowChromeProfile?.({
      titlebar: resolvedAppearance.composition.titlebar,
    }).catch(() => undefined);
  }, [
    activeThemeMode,
    activeThemePreset,
    interfaceStyle,
    resolvedAppearance,
    resolvedTheme,
  ]);

  useEffect(() => {
    window.localStorage.setItem(DIFF_MARKERS_STORAGE_KEY, diffMarkers);
  }, [diffMarkers]);

  useEffect(() => {
    if (!initialAppearanceRead.writable) return;
    const preferences = createAppearancePreferencesV6({
      activeRootThemeId: interfaceStyle,
      shared: {
        typography: typographyPreferences,
        pointerCursors,
        loadingAnimationPreset,
        fileIconTheme,
        sidebarNavigationLayout,
      },
      byRootTheme,
      bySurface: { markdown: markdownPresentation },
    });
    try {
      window.localStorage.setItem(
        APPEARANCE_PREFERENCES_STORAGE_KEY,
        serializeAppearancePreferences(preferences),
      );
      removeLegacyAppearancePreferences();
    } catch {
      // Persistence failure must not crash the renderer or erase migration inputs.
    }
  }, [
    byRootTheme,
    fileIconTheme,
    initialAppearanceRead.writable,
    interfaceStyle,
    loadingAnimationPreset,
    markdownPresentation,
    pointerCursors,
    sidebarNavigationLayout,
    typographyPreferences,
  ]);

  useEffect(() => {
    const syncAppearanceAcrossWindows = (event: StorageEvent) => {
      if (event.key !== APPEARANCE_PREFERENCES_STORAGE_KEY || !event.newValue) return;
      const result = readAppearancePreferences(event.newValue, {
        activeStyle: interfaceStyle,
        themeMode,
        lightThemePreset,
        darkThemePreset,
        legacySubThemeId: requestedSubThemeId,
        markdownPresentation,
        legacyTextSize: "default",
        typography: typographyPreferences,
        pointerCursors,
        loadingAnimationPreset,
        fileIconTheme,
        sidebarNavigationLayout,
      });
      if (result.source === "future") return;
      const next = result.preferences;
      setInterfaceStyle(next.activeRootThemeId);
      setByRootTheme(next.byRootTheme);
      setTypographyPreferences(next.shared.typography);
      setPointerCursors(next.shared.pointerCursors);
      setLoadingAnimationPreset(next.shared.loadingAnimationPreset);
      setFileIconTheme(next.shared.fileIconTheme);
      setSidebarNavigationLayout(next.shared.sidebarNavigationLayout);
      setMarkdownPresentation(next.bySurface.markdown);
    };
    window.addEventListener("storage", syncAppearanceAcrossWindows);
    return () => window.removeEventListener("storage", syncAppearanceAcrossWindows);
  }, [
    darkThemePreset,
    fileIconTheme,
    interfaceStyle,
    lightThemePreset,
    loadingAnimationPreset,
    markdownPresentation,
    pointerCursors,
    requestedSubThemeId,
    sidebarNavigationLayout,
    themeMode,
    typographyPreferences,
  ]);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_NAVIGATION_VISIBILITY_STORAGE_KEY,
      JSON.stringify(sidebarNavigationVisibilitySettings),
    );
  }, [sidebarNavigationVisibilitySettings]);

  useEffect(() => {
    window.localStorage.setItem(GIT_DISPLAY_MODE_STORAGE_KEY, gitDisplayMode);
  }, [gitDisplayMode]);

  useEffect(() => {
    window.localStorage.setItem(GIT_SIDEBAR_LAYOUT_STORAGE_KEY, gitSidebarLayout);
  }, [gitSidebarLayout]);

  useEffect(() => {
    window.localStorage.setItem(FILES_VISIBILITY_STORAGE_KEY, JSON.stringify(filesVisibilitySettings));
  }, [filesVisibilitySettings]);

  useEffect(() => {
    // Retired per-file-type overrides must not continue to shadow the system
    // default after the setting has been removed.
    window.localStorage.removeItem("puppyone.desktop.externalApps");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CREATE_NEW_MENU_STORAGE_KEY, JSON.stringify(createNewMenuSettings));
  }, [createNewMenuSettings]);

  useEffect(() => {
    const syncCreateNewMenuSettings = (event: StorageEvent) => {
      if (event.key !== CREATE_NEW_MENU_STORAGE_KEY && event.key !== null) return;
      setCreateNewMenuSettings(parseCreateNewMenuSettings(event.key === null ? null : event.newValue));
    };
    window.addEventListener("storage", syncCreateNewMenuSettings);
    return () => window.removeEventListener("storage", syncCreateNewMenuSettings);
  }, []);

  useEffect(() => {
    const { enableGitAutoCommit: _mainOwned, ...rendererOwned } = experimentalSettings;
    void _mainOwned;
    window.localStorage.setItem(EXPERIMENTAL_SETTINGS_STORAGE_KEY, JSON.stringify(rendererOwned));
  }, [experimentalSettings]);

  useEffect(() => {
    const desktop = window.puppyoneDesktop;
    if (!desktop?.getGitAutoCommitSettings) return;
    let active = true;
    const applySnapshot = (snapshot: { experimentalOptIn: boolean }) => {
      if (!active) return;
      setExperimentalSettingsState((current) => ({
        ...current,
        enableGitAutoCommit: snapshot.experimentalOptIn === true,
      }));
    };
    void desktop.getGitAutoCommitSettings().then(applySnapshot).catch(() => undefined);
    const stop = desktop.onGitAutoCommitStateChanged?.(applySnapshot);
    return () => {
      active = false;
      stop?.();
    };
  }, []);

  const setExperimentalSettings = useCallback((next: ExperimentalSettings) => {
    setExperimentalSettingsState((current) => ({
      ...next,
      enableGitAutoCommit: current.enableGitAutoCommit,
    }));
    const desktop = window.puppyoneDesktop;
    if (!desktop?.setGitAutoCommitExperimentalOptIn
      || next.enableGitAutoCommit === experimentalSettings.enableGitAutoCommit) return;
    void desktop.setGitAutoCommitExperimentalOptIn({
      enabled: next.enableGitAutoCommit,
    }).then((snapshot) => {
      setExperimentalSettingsState((current) => ({
        ...current,
        enableGitAutoCommit: snapshot.experimentalOptIn === true,
      }));
    }).catch(() => undefined);
  }, [experimentalSettings.enableGitAutoCommit]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_SIDEBAR_TOOLS_STORAGE_KEY, JSON.stringify(rightSidebarToolsSettings));
  }, [rightSidebarToolsSettings]);

  useEffect(() => {
    window.localStorage.setItem(TITLEBAR_ACTIONS_STORAGE_KEY, JSON.stringify(titlebarActionsSettings));
  }, [titlebarActionsSettings]);

  useEffect(() => {
    window.localStorage.setItem(LOCAL_AGENTS_STORAGE_KEY, JSON.stringify(localAgentsSettings));
  }, [localAgentsSettings]);

  useLayoutEffect(() => {
    window.localStorage.setItem(
      AGENT_FILE_ACTIVITY_INDICATORS_STORAGE_KEY,
      agentFileActivityIndicatorsEnabled ? "true" : "false",
    );
    document.documentElement.dataset.agentFileActivity = agentFileActivityIndicatorsEnabled
      ? "visible"
      : "hidden";
  }, [agentFileActivityIndicatorsEnabled]);

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
    window.localStorage.setItem(
      PROJECT_SWITCHER_EXPANDED_STORAGE_KEY,
      projectSwitcherExpanded ? "true" : "false",
    );
  }, [projectSwitcherExpanded]);

  useEffect(() => {
    window.localStorage.setItem(PROJECT_SWITCHER_WIDTH_STORAGE_KEY, String(projectSwitcherWidth));
  }, [projectSwitcherWidth]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_SIDEBAR_SURFACE_STORAGE_KEY, rightSidebarSurface);
  }, [rightSidebarSurface]);

  useEffect(() => {
    window.localStorage.setItem(
      AGENT_ROUTING_PREFERENCES_STORAGE_KEY,
      serializeAgentRoutingPreferences(agentRoutingPreferences),
    );
    window.localStorage.removeItem(AGENT_PREFERRED_RUNTIME_STORAGE_KEY);
    window.localStorage.removeItem(AGENT_PREFERRED_MODEL_STORAGE_KEY);
  }, [agentRoutingPreferences]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const sidebarNavigationPlacement = resolvedAppearance.sidebarNavigationPlacement;
  const sidebarNavigationOrientation = resolvedAppearance.sidebarNavigationOrientation;
  const terminalToolEnabled = rightSidebarToolsSettings.enabled.terminal;

  return {
    aiEditAssistEnabled,
    activeThemeMode,
    diffMarkers,
    markdownPresentation,
    explorerWidth,
    createNewMenuSettings,
    experimentalSettings,
    fileIconTheme: resolvedAppearance.fileIconTheme,
    filesVisibilitySettings,
    gitDisplayMode,
    gitSidebarLayout,
    interfaceStyle,
    resolvedAppearance,
    resolvedTheme,
    rightSidebarOpen,
    rightSidebarToolsSettings,
    rightSidebarWidth,
    rightSidebarSurface,
    agentPreferredRuntime,
    agentPreferredRoute,
    agentPreferredModel,
    agentRoutingPreferences,
    agentFileActivityIndicatorsEnabled,
    sidebarCollapsed,
    sidebarNavigationLayout,
    effectiveSidebarNavigationLayout: resolvedAppearance.sidebarNavigationLayout,
    sidebarNavigationOrientation,
    sidebarNavigationPlacement,
    sidebarNavigationVisibilitySettings,
    requestedSubThemeId,
    requestedSubThemeIds,
    terminalToolEnabled,
    titlebarActionsSettings,
    darkThemePreset,
    lightThemePreset,
    loadingAnimationPreset,
    localAgentsSettings,
    themeMode,
    typographyPreferences,
    pointerCursors,
    projectSwitcherExpanded,
    projectSwitcherWidth,
    setAiEditAssistEnabled,
    setDiffMarkers,
    setMarkdownPresentation,
    setExplorerWidth,
    setCreateNewMenuSettings,
    setExperimentalSettings,
    setFileIconTheme,
    setFilesVisibilitySettings,
    setGitDisplayMode,
    setGitSidebarLayout,
    setInterfaceStyle,
    setRightSidebarOpen,
    setRightSidebarToolsSettings,
    setRightSidebarWidth,
    setRightSidebarSurface,
    setAgentPreferredRuntime,
    setAgentPreferredRoute,
    setAgentPreferredModel,
    setAgentFileActivityIndicatorsEnabled,
    setSidebarCollapsed,
    setSidebarNavigationLayout,
    setSidebarNavigationVisibilitySettings,
    setSubThemeId,
    setTitlebarActionsSettings,
    setLoadingAnimationPreset,
    setLocalAgentsSettings,
    setPointerCursors,
    setProjectSwitcherExpanded,
    setProjectSwitcherWidth,
    setThemeMode,
    setTypographyPreferences,
  };
}

export type DesktopPreferencesController = ReturnType<typeof useDesktopPreferences>;

function updateRootThemePreference(
  current: Readonly<Record<string, RootThemeAppearancePreferences>>,
  rootThemeId: InterfaceStyle,
  patch: Partial<RootThemeAppearancePreferences>,
): Readonly<Record<string, RootThemeAppearancePreferences>> {
  const existing = current[rootThemeId] ?? createDefaultRootThemePreference(rootThemeId);
  return Object.freeze({
    ...current,
    [rootThemeId]: Object.freeze({ ...existing, ...patch }),
  });
}

function updateRootThemeSubTheme(
  current: Readonly<Record<string, RootThemeAppearancePreferences>>,
  rootThemeId: InterfaceStyle,
  colorMode: "light" | "dark",
  subThemeId: string,
): Readonly<Record<string, RootThemeAppearancePreferences>> {
  const existing = current[rootThemeId] ?? createDefaultRootThemePreference(rootThemeId);
  return updateRootThemePreference(current, rootThemeId, {
    requestedSubThemeIds: Object.freeze({
      ...existing.requestedSubThemeIds,
      [colorMode]: subThemeId,
    }),
  });
}

function createDefaultRootThemePreference(
  rootThemeId: InterfaceStyle,
): RootThemeAppearancePreferences {
  return Object.freeze({
    requestedColorMode: rootThemeId === "windows-xp" ? "light" : "system",
    requestedSubThemeIds: Object.freeze({
      light: getDefaultSubThemeId(rootThemeId, "light"),
      dark: getDefaultSubThemeId(rootThemeId, "dark"),
    }),
  });
}
