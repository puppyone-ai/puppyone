import type { FileIconThemeId } from "@puppyone/shared-ui";
import type { AgentRoutePreference, AgentRoutingPreferences } from "../../agentRoutingPreferences";
import type { CreateNewMenuSettings, DiffMarkers, ExperimentalSettings, FilesVisibilitySettings, GitDisplayMode, GitSidebarLayout, InterfaceStyle, LoadingAnimationPreset, LocalAgentsSettings, RightSidebarToolsSettings, ThemeMode, TitlebarActionsSettings, TypographyPreferences } from "../../preferences";
import type { RightSidebarSurface } from "../../preferenceStorage";
import type { RootThemeAppearancePreferences } from "../appearance";
import type { MarkdownPresentationSettings } from "../markdown";
import type { SubThemeCatalogSnapshot } from "../themes";
export type PreferenceUpdate<T> = T | ((current: T) => T);
export type PreferenceAction<T> = (update: PreferenceUpdate<T>) => void;

export type AppearanceSlice = {
  interfaceStyle: InterfaceStyle;
  byRootTheme: Readonly<Record<string, RootThemeAppearancePreferences>>;
  typographyPreferences: TypographyPreferences;
  pointerCursors: boolean;
  loadingAnimationPreset: LoadingAnimationPreset;
  fileIconTheme: FileIconThemeId;
  // Runtime inputs are intentionally excluded from persistence.
  systemDark: boolean;
  subThemeCatalog: SubThemeCatalogSnapshot;
  appearanceWritable: boolean;
  setInterfaceStyle: PreferenceAction<InterfaceStyle>;
  setTypographyPreferences: PreferenceAction<TypographyPreferences>;
  setPointerCursors: PreferenceAction<boolean>;
  setLoadingAnimationPreset: PreferenceAction<LoadingAnimationPreset>;
  setFileIconTheme: PreferenceAction<FileIconThemeId>;
  setThemeMode: (mode: ThemeMode) => void;
  setSubThemeId: (id: string) => void;
};

export type LayoutSlice = {
  explorerWidth: number;
  setExplorerWidth: PreferenceAction<number>;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: PreferenceAction<boolean>;
  projectSwitcherExpanded: boolean;
  setProjectSwitcherExpanded: PreferenceAction<boolean>;
  projectSwitcherWidth: number;
  setProjectSwitcherWidth: PreferenceAction<number>;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: PreferenceAction<boolean>;
  rightSidebarWidth: number;
  setRightSidebarWidth: PreferenceAction<number>;
  rightSidebarSurface: RightSidebarSurface;
  setRightSidebarSurface: PreferenceAction<RightSidebarSurface>;
  rightSidebarToolsSettings: RightSidebarToolsSettings;
  setRightSidebarToolsSettings: PreferenceAction<RightSidebarToolsSettings>;
  titlebarActionsSettings: TitlebarActionsSettings;
  setTitlebarActionsSettings: PreferenceAction<TitlebarActionsSettings>;
};

export type GitDisplaySlice = {
  diffMarkers: DiffMarkers;
  setDiffMarkers: PreferenceAction<DiffMarkers>;
  gitDisplayMode: GitDisplayMode;
  setGitDisplayMode: PreferenceAction<GitDisplayMode>;
  gitSidebarLayout: GitSidebarLayout;
  setGitSidebarLayout: PreferenceAction<GitSidebarLayout>;
};

export type EditorSlice = {
  aiEditAssistEnabled: boolean;
  setAiEditAssistEnabled: PreferenceAction<boolean>;
  filesVisibilitySettings: FilesVisibilitySettings;
  setFilesVisibilitySettings: PreferenceAction<FilesVisibilitySettings>;
  createNewMenuSettings: CreateNewMenuSettings;
  setCreateNewMenuSettings: PreferenceAction<CreateNewMenuSettings>;
  markdownPresentation: MarkdownPresentationSettings;
  setMarkdownPresentation: PreferenceAction<MarkdownPresentationSettings>;
};

export type AgentSlice = {
  localAgentsSettings: LocalAgentsSettings;
  setLocalAgentsSettings: PreferenceAction<LocalAgentsSettings>;
  agentFileActivityIndicatorsEnabled: boolean;
  setAgentFileActivityIndicatorsEnabled: PreferenceAction<boolean>;
  agentRoutingPreferences: AgentRoutingPreferences;
  setAgentPreferredRuntime: (runtimeId: string | null) => void;
  setAgentPreferredRoute: (patch: Partial<AgentRoutePreference>) => void;
  setAgentPreferredModel: (modelId: string | null) => void;
};

export type ExperimentsSlice = {
  experimentalSettings: ExperimentalSettings;
  setExperimentalSettings: PreferenceAction<ExperimentalSettings>;
};

export type ShareSlice = {
  /** Id of the destination a project was last connected to, if any. */
  reachLastAgentId: string | null;
  setReachLastAgentId: (id: string | null) => void;
};

export type DesktopPreferenceState = AppearanceSlice & LayoutSlice & GitDisplaySlice & AgentSlice & EditorSlice & ExperimentsSlice & ShareSlice;
