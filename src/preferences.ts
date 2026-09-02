import {
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  parseTypographyPreferences,
  type TypographyPreferences,
} from "./features/typography/fontCatalog";
import {
  DEFAULT_INTERFACE_STYLE,
  DARK_THEME_PRESET_STORAGE_KEY,
  INTERFACE_STYLE_STORAGE_KEY,
  LEGACY_THEME_PRESET_STORAGE_KEY,
  LIGHT_THEME_PRESET_STORAGE_KEY,
  THEME_STORAGE_KEY,
  parseInterfaceStyle,
  resolveActiveThemeMode,
  type InterfaceStyle,
  type ThemeMode,
} from "./features/appearance/interfaceStyles";
import type { PulseGridPresetId } from "@puppyone/shared-ui";
import {
  CREATE_NEW_ITEM_IDS,
  CREATE_NEW_SUBMENU_ID,
  getCreateEntryMenuItem,
  getDefaultCreateNewMenuLayout,
  type CreateNewMainMenuEntry,
  type CreateNewItemId,
  type CreateNewMenuPlacement,
  type CreateNewSubmenuId,
} from "./features/create-new/createEntryMenuRegistry";

export type { TypographyPreferences } from "./features/typography/fontCatalog";
export {
  DEFAULT_INTERFACE_STYLE,
  DARK_THEME_PRESET_STORAGE_KEY,
  INTERFACE_STYLE_STORAGE_KEY,
  LEGACY_THEME_PRESET_STORAGE_KEY,
  LIGHT_THEME_PRESET_STORAGE_KEY,
  THEME_STORAGE_KEY,
  parseInterfaceStyle,
  resolveActiveThemeMode,
};
export type { InterfaceStyle, ThemeMode };
export { CREATE_NEW_ITEM_IDS, CREATE_NEW_SUBMENU_ID };
export type {
  CreateNewItemId,
  CreateNewMainMenuEntry,
  CreateNewMenuPlacement,
  CreateNewSubmenuId,
};

export type LightThemePreset = "neutral" | "warm" | "graphite";
export type DarkThemePreset = "default" | "warm" | "graphite";
export type TextSize = "small" | "default" | "large";
export type DiffMarkers = "color" | "symbols";
export type GitDisplayMode = "simple" | "professional";
export type GitSidebarLayout = "cards" | "dividers";
export type LoadingAnimationPreset = PulseGridPresetId;

export type SidebarNavigationLayout =
  | "bottom-horizontal"
  | "top-horizontal"
  | "left-vertical";

export type SidebarNavigationPlacement = "top" | "left" | "bottom";
export type SidebarNavigationOrientation = "horizontal" | "vertical";
export const OPTIONAL_SIDEBAR_NAVIGATION_ITEM_IDS = ["plugins"] as const;
export type OptionalSidebarNavigationItemId = typeof OPTIONAL_SIDEBAR_NAVIGATION_ITEM_IDS[number];
export type SidebarNavigationVisibilitySettings = {
  enabled: Record<OptionalSidebarNavigationItemId, boolean>;
};
export type FilesVisibilitySettings = {
  showHiddenFiles: boolean;
  excludePatterns: string[];
};
export const RIGHT_SIDEBAR_TOOL_IDS = ["terminal"] as const;
export type RightSidebarToolId = typeof RIGHT_SIDEBAR_TOOL_IDS[number];
export type RightSidebarToolsSettings = {
  enabled: Record<RightSidebarToolId, boolean>;
  order: RightSidebarToolId[];
};
export const TITLEBAR_ACTION_IDS = ["terminal"] as const;
export type TitlebarActionId = typeof TITLEBAR_ACTION_IDS[number];
export type TitlebarActionsSettings = {
  enabled: Record<TitlebarActionId, boolean>;
  order: TitlebarActionId[];
};
export type LocalAgentsSettings = {
  hiddenTerminalAgentIds: string[];
  chatHistoryDiscoveryEnabled: boolean;
};
export type ExperimentalSettings = {
  enableAgentChat: boolean;
  enableAssetLibraryHome: boolean;
  enableCloudAutomation: boolean;
  enableCloudWorkspace: boolean;
  enableEditorSaveStatus: boolean;
  enableFirstProjectStarter: boolean;
  enableGitAutoCommit: boolean;
  enableMarkdownBlockDrag: boolean;
  enableMultiRootWorkspaces: boolean;
  enablePuppyFlowFiles: boolean;
  enableViewerPlugins: boolean;
};

export const CREATE_NEW_MENU_VERSION = 5 as const;
export type CreateNewMenuSettings = {
  version: typeof CREATE_NEW_MENU_VERSION;
  main: CreateNewMainMenuEntry[];
  submenu: CreateNewItemId[];
  hidden: CreateNewItemId[];
};

export const TEXT_SIZE_STORAGE_KEY = "puppyone.desktop.textSize";
export const TYPOGRAPHY_STORAGE_KEY = "puppyone.desktop.typography";
export const POINTER_CURSORS_STORAGE_KEY = "puppyone.desktop.pointerCursors";
export const LOADING_ANIMATION_STORAGE_KEY = "puppyone.desktop.loadingAnimation";
export const DIFF_MARKERS_STORAGE_KEY = "puppyone.desktop.diffMarkers";
export const MARKDOWN_PRESENTATION_STORAGE_KEY = "puppyone.desktop.markdownPresentation";
/** @deprecated Legacy single-value emphasis preset storage. */
export const MARKDOWN_EMPHASIS_STORAGE_KEY = "puppyone.desktop.markdownEmphasis";
export const FILE_ICON_THEME_STORAGE_KEY = "puppyone.desktop.fileIconTheme";
export const SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY = "puppyone.desktop.sidebarNavigationLayout";
export const SIDEBAR_NAVIGATION_VISIBILITY_STORAGE_KEY = "puppyone.desktop.sidebarNavigationVisibility";
export const FILES_VISIBILITY_STORAGE_KEY = "puppyone.desktop.filesVisibility";
export const RIGHT_SIDEBAR_TOOLS_STORAGE_KEY = "puppyone.desktop.rightSidebarTools";
export const TITLEBAR_ACTIONS_STORAGE_KEY = "puppyone.desktop.titlebarActions";
export const LOCAL_AGENTS_STORAGE_KEY = "puppyone.desktop.localAgents";
export const AGENT_FILE_ACTIVITY_INDICATORS_STORAGE_KEY = "puppyone.desktop.agentFileActivityIndicators";
export const AI_EDIT_ASSIST_STORAGE_KEY = "puppyone.desktop.aiEditAssist";
export const GIT_DISPLAY_MODE_STORAGE_KEY = "puppyone.desktop.gitDisplayMode";
export const GIT_SIDEBAR_LAYOUT_STORAGE_KEY = "puppyone.desktop.gitSidebarLayout";
export const EXPERIMENTAL_SETTINGS_STORAGE_KEY = "puppyone.desktop.experimental";
export const CREATE_NEW_MENU_STORAGE_KEY = "puppyone.desktop.createNewMenu";

export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_LIGHT_THEME_PRESET: LightThemePreset = "neutral";
export const DEFAULT_DARK_THEME_PRESET: DarkThemePreset = "default";
export const DEFAULT_TEXT_SIZE: TextSize = "default";
export { DEFAULT_TYPOGRAPHY_PREFERENCES };
export const DEFAULT_POINTER_CURSORS = false;
export const DEFAULT_LOADING_ANIMATION_PRESET: LoadingAnimationPreset = "ikun";
export const DEFAULT_DIFF_MARKERS: DiffMarkers = "color";
export const DEFAULT_GIT_DISPLAY_MODE: GitDisplayMode = "simple";
export const DEFAULT_GIT_SIDEBAR_LAYOUT: GitSidebarLayout = "cards";
export const DEFAULT_SIDEBAR_NAVIGATION_LAYOUT: SidebarNavigationLayout = "bottom-horizontal";
export const DEFAULT_SIDEBAR_NAVIGATION_VISIBILITY_SETTINGS: SidebarNavigationVisibilitySettings = {
  enabled: {
    plugins: true,
  },
};
export const DEFAULT_EXPLORER_EXCLUDE_PATTERNS = [
  "**/.git",
  "**/.puppyone",
  "**/.svn",
  "**/.hg",
  "**/.DS_Store",
  "**/Thumbs.db",
];
export const DEFAULT_FILES_VISIBILITY_SETTINGS: FilesVisibilitySettings = {
  showHiddenFiles: false,
  excludePatterns: [...DEFAULT_EXPLORER_EXCLUDE_PATTERNS],
};
export const DEFAULT_RIGHT_SIDEBAR_TOOLS_SETTINGS: RightSidebarToolsSettings = {
  enabled: {
    terminal: true,
  },
  order: [...RIGHT_SIDEBAR_TOOL_IDS],
};
export const DEFAULT_TITLEBAR_ACTIONS_SETTINGS: TitlebarActionsSettings = {
  enabled: {
    terminal: true,
  },
  order: [...TITLEBAR_ACTION_IDS],
};
export const DEFAULT_LOCAL_AGENTS_SETTINGS: LocalAgentsSettings = {
  hiddenTerminalAgentIds: [],
  chatHistoryDiscoveryEnabled: false,
};
export const DEFAULT_AGENT_FILE_ACTIVITY_INDICATORS_ENABLED = false;
export const DEFAULT_AI_EDIT_ASSIST_ENABLED = false;
export const DEFAULT_EXPERIMENTAL_SETTINGS: ExperimentalSettings = {
  enableAgentChat: false,
  enableAssetLibraryHome: false,
  enableCloudAutomation: false,
  enableCloudWorkspace: false,
  enableEditorSaveStatus: false,
  enableFirstProjectStarter: false,
  enableGitAutoCommit: false,
  enableMarkdownBlockDrag: false,
  enableMultiRootWorkspaces: false,
  enablePuppyFlowFiles: false,
  enableViewerPlugins: false,
};
const DEFAULT_CREATE_NEW_MENU_LAYOUT = getDefaultCreateNewMenuLayout();
export const DEFAULT_CREATE_NEW_MENU_SETTINGS: CreateNewMenuSettings = {
  version: CREATE_NEW_MENU_VERSION,
  main: DEFAULT_CREATE_NEW_MENU_LAYOUT.main,
  submenu: DEFAULT_CREATE_NEW_MENU_LAYOUT.submenu,
  hidden: DEFAULT_CREATE_NEW_MENU_LAYOUT.hidden,
};

export const SIDEBAR_NAVIGATION_LAYOUT_OPTIONS = [
  {
    value: "bottom-horizontal",
    label: "Bottom",
    description: "Horizontal controls at the bottom of the sidebar.",
    placement: "bottom",
    orientation: "horizontal",
  },
  {
    value: "top-horizontal",
    label: "Top",
    description: "Horizontal controls above the file tree.",
    placement: "top",
    orientation: "horizontal",
  },
  {
    value: "left-vertical",
    label: "Left",
    description: "Vertical controls on the left edge of the sidebar.",
    placement: "left",
    orientation: "vertical",
  },
] as const satisfies ReadonlyArray<{
  value: SidebarNavigationLayout;
  label: string;
  description: string;
  placement: SidebarNavigationPlacement;
  orientation: SidebarNavigationOrientation;
}>;

export const LIGHT_THEME_PRESETS = [
  {
    id: "neutral",
    label: "Neutral",
    description: "Clean light surfaces with restrained contrast.",
    swatches: ["#f5f4f0", "#ffffff", "#2563eb"],
  },
  {
    id: "warm",
    label: "Warm",
    description: "The original Puppyone default desktop palette.",
    swatches: ["#f1eee8", "#fbfaf7", "#2563eb"],
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "Cooler surfaces for a denser workspace feel.",
    swatches: ["#f3f4f6", "#ffffff", "#4f46e5"],
  },
] as const satisfies ReadonlyArray<{
  id: LightThemePreset;
  label: string;
  description: string;
  swatches: readonly [string, string, string];
}>;

export const DARK_THEME_PRESETS = [
  {
    id: "default",
    label: "Default",
    description: "The current Puppyone dark palette.",
    swatches: ["#11100f", "#1d1b1a", "#60a5fa"],
  },
  {
    id: "warm",
    label: "Warm",
    description: "A softly amber dark palette for late-night work.",
    swatches: ["#18130f", "#211a14", "#f0a45d"],
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "A cooler dark workspace palette.",
    swatches: ["#101114", "#1b1c1f", "#8b8cff"],
  },
] as const satisfies ReadonlyArray<{
  id: DarkThemePreset;
  label: string;
  description: string;
  swatches: readonly [string, string, string];
}>;

export const TEXT_SIZE_PRESETS = [
  {
    value: "small",
    label: "Small",
    description: "Editor content 13px.",
    sizes: { content: 13 },
  },
  {
    value: "default",
    label: "Default",
    description: "Editor content 14px.",
    sizes: { content: 14 },
  },
  {
    value: "large",
    label: "Large",
    description: "Editor content 16px.",
    sizes: { content: 16 },
  },
] as const satisfies ReadonlyArray<{
  value: TextSize;
  label: string;
  description: string;
  sizes: { content: number };
}>;

export function parseThemeMode(value: string | null | undefined): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : DEFAULT_THEME_MODE;
}

export function parseLightThemePreset(value: string | null | undefined): LightThemePreset {
  return isLightThemePreset(value) ? value : DEFAULT_LIGHT_THEME_PRESET;
}

export function isLightThemePreset(value: string | null | undefined): value is LightThemePreset {
  return value === "neutral" || value === "warm" || value === "graphite";
}

export function parseDarkThemePreset(value: string | null | undefined): DarkThemePreset {
  return isDarkThemePreset(value) ? value : DEFAULT_DARK_THEME_PRESET;
}

export function isDarkThemePreset(value: string | null | undefined): value is DarkThemePreset {
  return value === "default" || value === "warm" || value === "graphite";
}

export function parseTextSize(value: string | null | undefined): TextSize {
  return value === "small" || value === "large" || value === "default" ? value : DEFAULT_TEXT_SIZE;
}

export function parseTypography(value: string | null | undefined): TypographyPreferences {
  return parseTypographyPreferences(value);
}

export function parsePointerCursors(value: string | null | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return DEFAULT_POINTER_CURSORS;
}

export function parseLoadingAnimationPreset(
  value: string | null | undefined,
): LoadingAnimationPreset {
  return value === "ymca" || value === "siu" || value === "ikun" ? value : DEFAULT_LOADING_ANIMATION_PRESET;
}

export function parseDiffMarkers(value: string | null | undefined): DiffMarkers {
  return value === "symbols" || value === "color" ? value : DEFAULT_DIFF_MARKERS;
}

export function parseGitDisplayMode(value: string | null | undefined): GitDisplayMode {
  return value === "professional" || value === "simple" ? value : DEFAULT_GIT_DISPLAY_MODE;
}

export function parseGitSidebarLayout(value: string | null | undefined): GitSidebarLayout {
  return value === "dividers" || value === "cards" ? value : DEFAULT_GIT_SIDEBAR_LAYOUT;
}

export function parseSidebarNavigationLayout(value: string | null | undefined): SidebarNavigationLayout {
  if (value === "bottom") return "bottom-horizontal";
  if (value === "top") return "top-horizontal";
  if (value === "vertical" || value === "bottom-vertical" || value === "top-vertical") return "left-vertical";
  return isSidebarNavigationLayout(value) ? value : DEFAULT_SIDEBAR_NAVIGATION_LAYOUT;
}

export function isSidebarNavigationLayout(value: string | null | undefined): value is SidebarNavigationLayout {
  return value === "bottom-horizontal"
    || value === "top-horizontal"
    || value === "left-vertical";
}

export function getSidebarNavigationPlacement(layout: SidebarNavigationLayout): SidebarNavigationPlacement {
  return SIDEBAR_NAVIGATION_LAYOUT_OPTIONS.find((option) => option.value === layout)?.placement ?? "bottom";
}

export function getSidebarNavigationOrientation(layout: SidebarNavigationLayout): SidebarNavigationOrientation {
  return SIDEBAR_NAVIGATION_LAYOUT_OPTIONS.find((option) => option.value === layout)?.orientation ?? "horizontal";
}

export function parseSidebarNavigationVisibilitySettings(
  value: string | null | undefined,
): SidebarNavigationVisibilitySettings {
  if (!value) return DEFAULT_SIDEBAR_NAVIGATION_VISIBILITY_SETTINGS;

  try {
    const parsed = JSON.parse(value) as { enabled?: Partial<Record<OptionalSidebarNavigationItemId, unknown>> } | null;
    if (!parsed || typeof parsed !== "object" || !parsed.enabled || typeof parsed.enabled !== "object") {
      return DEFAULT_SIDEBAR_NAVIGATION_VISIBILITY_SETTINGS;
    }
    return {
      enabled: {
        plugins: parsed.enabled.plugins !== false,
      },
    };
  } catch {
    return DEFAULT_SIDEBAR_NAVIGATION_VISIBILITY_SETTINGS;
  }
}

export function parseFilesVisibilitySettings(value: string | null | undefined): FilesVisibilitySettings {
  if (!value) return DEFAULT_FILES_VISIBILITY_SETTINGS;

  try {
    const parsed = JSON.parse(value) as Partial<FilesVisibilitySettings> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_FILES_VISIBILITY_SETTINGS;

    return {
      showHiddenFiles: parsed.showHiddenFiles === true,
      excludePatterns: Array.isArray(parsed.excludePatterns)
        ? normalizeExplorerExcludePatterns(parsed.excludePatterns)
        : [...DEFAULT_EXPLORER_EXCLUDE_PATTERNS],
    };
  } catch {
    return DEFAULT_FILES_VISIBILITY_SETTINGS;
  }
}

export function parseRightSidebarToolsSettings(value: string | null | undefined): RightSidebarToolsSettings {
  if (!value) return DEFAULT_RIGHT_SIDEBAR_TOOLS_SETTINGS;

  try {
    const parsed = JSON.parse(value) as Partial<RightSidebarToolsSettings> | Partial<Record<RightSidebarToolId, boolean>> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_RIGHT_SIDEBAR_TOOLS_SETTINGS;

    return {
      enabled: {
        terminal: readRightSidebarToolEnabled(parsed, "terminal"),
      },
      order: normalizeRightSidebarToolOrder("order" in parsed ? parsed.order : undefined),
    };
  } catch {
    return DEFAULT_RIGHT_SIDEBAR_TOOLS_SETTINGS;
  }
}

export function parseTitlebarActionsSettings(value: string | null | undefined): TitlebarActionsSettings {
  if (!value) return DEFAULT_TITLEBAR_ACTIONS_SETTINGS;

  try {
    const parsed = JSON.parse(value) as Partial<TitlebarActionsSettings> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_TITLEBAR_ACTIONS_SETTINGS;

    return {
      enabled: {
        terminal: readTitlebarActionEnabled(parsed, "terminal", true),
      },
      order: normalizeTitlebarActionOrder(parsed.order),
    };
  } catch {
    return DEFAULT_TITLEBAR_ACTIONS_SETTINGS;
  }
}

export function parseLocalAgentsSettings(
  value: string | null | undefined,
): LocalAgentsSettings {
  if (!value) return DEFAULT_LOCAL_AGENTS_SETTINGS;
  try {
    const parsed = JSON.parse(value) as {
      hiddenTerminalAgentIds?: unknown;
      enabledAgentIds?: unknown;
      chatHistoryDiscoveryEnabled?: unknown;
    } | null;
    // The legacy enabledAgentIds field controlled Editor provider visibility.
    // It must not silently hide Terminal launchers after the preference changes meaning.
    if (!parsed || typeof parsed !== "object") return DEFAULT_LOCAL_AGENTS_SETTINGS;
    const hiddenTerminalAgentIds = Array.from(new Set((Array.isArray(parsed.hiddenTerminalAgentIds)
      ? parsed.hiddenTerminalAgentIds
      : []).filter(
      (id): id is string => typeof id === "string" && /^[a-z0-9][a-z0-9._-]{0,79}$/u.test(id),
    ))).slice(0, 16);
    return {
      hiddenTerminalAgentIds,
      chatHistoryDiscoveryEnabled: parsed.chatHistoryDiscoveryEnabled === true,
    };
  } catch {
    return DEFAULT_LOCAL_AGENTS_SETTINGS;
  }
}

export function parseAgentFileActivityIndicatorsEnabled(
  value: string | null | undefined,
): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return DEFAULT_AGENT_FILE_ACTIVITY_INDICATORS_ENABLED;
}

export function parseAiEditAssistEnabled(value: string | null | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return DEFAULT_AI_EDIT_ASSIST_ENABLED;
}

export function parseExperimentalSettings(value: string | null | undefined): ExperimentalSettings {
  if (!value) return DEFAULT_EXPERIMENTAL_SETTINGS;

  try {
    const parsed = JSON.parse(value) as Partial<ExperimentalSettings> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_EXPERIMENTAL_SETTINGS;

    const legacy = parsed as typeof parsed & {
      enableAgentCompanion?: unknown;
    };
    return {
      enableAgentChat: parsed.enableAgentChat === true || legacy.enableAgentCompanion === true,
      enableAssetLibraryHome: parsed.enableAssetLibraryHome === true,
      enableCloudAutomation: parsed.enableCloudAutomation === true,
      enableCloudWorkspace: parsed.enableCloudWorkspace === true,
      enableEditorSaveStatus: parsed.enableEditorSaveStatus === true,
      enableFirstProjectStarter: parsed.enableFirstProjectStarter === true,
      // Main-owned Git Auto Commit consent is intentionally never restored
      // from renderer localStorage. The Electron capability bridge hydrates it.
      enableGitAutoCommit: false,
      enableMarkdownBlockDrag: parsed.enableMarkdownBlockDrag === true,
      enableMultiRootWorkspaces: parsed.enableMultiRootWorkspaces === true,
      enablePuppyFlowFiles: parsed.enablePuppyFlowFiles === true,
      enableViewerPlugins: parsed.enableViewerPlugins === true,
    };
  } catch {
    return DEFAULT_EXPERIMENTAL_SETTINGS;
  }
}

export function parseCreateNewMenuSettings(value: string | null | undefined): CreateNewMenuSettings {
  if (!value) return cloneDefaultCreateNewMenuSettings();

  try {
    const parsed = JSON.parse(value) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") {
      return cloneDefaultCreateNewMenuSettings();
    }

    if (parsed.version === CREATE_NEW_MENU_VERSION) {
      return normalizeCreateNewMenuLayout(parsed.main, parsed.submenu, parsed.hidden);
    }

    if (!Array.isArray(parsed.items)) {
      return cloneDefaultCreateNewMenuSettings();
    }

    const legacyItems: Array<{
      kind: CreateNewItemId;
      enabled: boolean;
      placement: Exclude<CreateNewMenuPlacement, "hidden">;
    }> = [];
    const seen = new Set<CreateNewItemId>();
    for (const rawItem of parsed.items) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const kind = "kind" in rawItem ? rawItem.kind : null;
      if (!isCreateNewItemId(kind) || seen.has(kind)) continue;
      seen.add(kind);
      const placement = "placement" in rawItem && (
        rawItem.placement === "main" || rawItem.placement === "submenu"
      )
        ? rawItem.placement
        : getCreateEntryMenuItem(kind).defaultPlacement;
      legacyItems.push({
        kind,
        enabled: !("enabled" in rawItem) || rawItem.enabled !== false,
        placement,
      });
    }

    if (parsed.items.length > 0 && legacyItems.length === 0) {
      return cloneDefaultCreateNewMenuSettings();
    }
    if (isLegacyCreateNewDefault(legacyItems)) {
      return cloneDefaultCreateNewMenuSettings();
    }

    const main: CreateNewMainMenuEntry[] = legacyItems
      .filter((item) => item.enabled && item.placement === "main")
      .map((item) => item.kind);
    main.push(CREATE_NEW_SUBMENU_ID);
    const submenu = legacyItems
      .filter((item) => item.enabled && item.placement === "submenu")
      .map((item) => item.kind);
    const hidden = legacyItems
      .filter((item) => !item.enabled)
      .map((item) => item.kind);
    for (const kind of CREATE_NEW_ITEM_IDS) {
      if (!seen.has(kind)) hidden.push(kind);
    }
    return { version: CREATE_NEW_MENU_VERSION, main, submenu, hidden };
  } catch {
    return cloneDefaultCreateNewMenuSettings();
  }
}

export function cloneDefaultCreateNewMenuSettings(): CreateNewMenuSettings {
  return {
    version: CREATE_NEW_MENU_VERSION,
    main: [...DEFAULT_CREATE_NEW_MENU_SETTINGS.main],
    submenu: [...DEFAULT_CREATE_NEW_MENU_SETTINGS.submenu],
    hidden: [...DEFAULT_CREATE_NEW_MENU_SETTINGS.hidden],
  };
}

export function isCreateNewItemId(value: unknown): value is CreateNewItemId {
  return typeof value === "string"
    && CREATE_NEW_ITEM_IDS.includes(value as CreateNewItemId);
}

export function isCreateNewMenuPlacement(value: unknown): value is CreateNewMenuPlacement {
  return value === "main" || value === "submenu" || value === "hidden";
}

export function isCreateNewItemAvailable(
  kind: CreateNewItemId,
  experimentalSettings: ExperimentalSettings,
): boolean {
  const experimentalSetting = getCreateEntryMenuItem(kind).experimentalSetting;
  return !experimentalSetting || experimentalSettings[experimentalSetting];
}

function normalizeCreateNewMenuLayout(
  rawMain: unknown,
  rawSubmenu: unknown,
  rawHidden: unknown,
): CreateNewMenuSettings {
  const main: CreateNewMainMenuEntry[] = [];
  const submenu: CreateNewItemId[] = [];
  const hidden: CreateNewItemId[] = [];
  const seenItems = new Set<CreateNewItemId>();
  let submenuSeen = false;

  if (Array.isArray(rawMain)) {
    for (const entry of rawMain) {
      if (entry === CREATE_NEW_SUBMENU_ID && !submenuSeen) {
        main.push(entry);
        submenuSeen = true;
      } else if (isCreateNewItemId(entry) && !seenItems.has(entry)) {
        main.push(entry);
        seenItems.add(entry);
      }
    }
  }
  if (!submenuSeen) main.push(CREATE_NEW_SUBMENU_ID);

  for (const [source, target] of [
    [rawSubmenu, submenu],
    [rawHidden, hidden],
  ] as const) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (!isCreateNewItemId(entry) || seenItems.has(entry)) continue;
      target.push(entry);
      seenItems.add(entry);
    }
  }

  for (const kind of CREATE_NEW_ITEM_IDS) {
    if (!seenItems.has(kind)) hidden.push(kind);
  }
  return { version: CREATE_NEW_MENU_VERSION, main, submenu, hidden };
}

function isLegacyCreateNewDefault(items: readonly {
  kind: CreateNewItemId;
  enabled: boolean;
}[]): boolean {
  const enabledKinds = items.filter((item) => item.enabled).map((item) => item.kind);
  return [
    ["markdown", "csv"],
    ["markdown", "csv", "html", "slides"],
    ["markdown", "contextMap", "csv", "html", "slides"],
  ].some((expected) => (
    enabledKinds.length === expected.length
    && enabledKinds.every((kind, index) => kind === expected[index])
  ));
}

export function resolveVisibleCreateNewMenuItems(
  settings: CreateNewMenuSettings,
  experimentalSettings: ExperimentalSettings,
): Readonly<{ main: CreateNewMainMenuEntry[]; submenu: CreateNewItemId[] }> {
  const submenu = settings.submenu.filter((kind) => (
    isCreateNewItemAvailable(kind, experimentalSettings)
  ));
  return {
    main: settings.main.filter((entry) => (
      entry === CREATE_NEW_SUBMENU_ID
        ? submenu.length > 0
        : isCreateNewItemAvailable(entry, experimentalSettings)
    )),
    submenu,
  };
}

function readRightSidebarToolEnabled(
  value: Partial<RightSidebarToolsSettings> | Partial<Record<RightSidebarToolId, boolean>>,
  toolId: RightSidebarToolId,
): boolean {
  if ("enabled" in value && value.enabled && typeof value.enabled === "object") {
    return value.enabled[toolId] !== false;
  }

  const legacyValue = value as Partial<Record<RightSidebarToolId, boolean>>;
  return legacyValue[toolId] !== false;
}

function normalizeRightSidebarToolOrder(value: unknown): RightSidebarToolId[] {
  const seen = new Set<RightSidebarToolId>();
  const order: RightSidebarToolId[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRightSidebarToolId(item) && !seen.has(item)) {
        seen.add(item);
        order.push(item);
      }
    }
  }

  for (const toolId of RIGHT_SIDEBAR_TOOL_IDS) {
    if (!seen.has(toolId)) order.push(toolId);
  }

  return order;
}

function isRightSidebarToolId(value: unknown): value is RightSidebarToolId {
  return typeof value === "string" && RIGHT_SIDEBAR_TOOL_IDS.includes(value as RightSidebarToolId);
}

function readTitlebarActionEnabled(
  value: Partial<TitlebarActionsSettings>,
  actionId: TitlebarActionId,
  defaultEnabled: boolean,
): boolean {
  if (!value.enabled || typeof value.enabled !== "object") return defaultEnabled;
  return value.enabled[actionId] !== false;
}

function normalizeTitlebarActionOrder(value: unknown): TitlebarActionId[] {
  const seen = new Set<TitlebarActionId>();
  const order: TitlebarActionId[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      if (isTitlebarActionId(item) && !seen.has(item)) {
        seen.add(item);
        order.push(item);
      }
    }
  }

  for (const actionId of TITLEBAR_ACTION_IDS) {
    if (!seen.has(actionId)) order.push(actionId);
  }

  return order;
}

function isTitlebarActionId(value: unknown): value is TitlebarActionId {
  return typeof value === "string" && TITLEBAR_ACTION_IDS.includes(value as TitlebarActionId);
}

export function normalizeExplorerExcludePatterns(value: string | string[]): string[] {
  const lines = Array.isArray(value)
    ? value
    : value.split(/\r?\n|,/);
  const seen = new Set<string>();
  const patterns: string[] = [];

  for (const rawLine of lines) {
    const pattern = rawLine.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    if (!pattern || pattern.startsWith("#") || seen.has(pattern)) continue;
    seen.add(pattern);
    patterns.push(pattern);
  }

  return patterns;
}
