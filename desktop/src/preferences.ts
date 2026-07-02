export type ThemeMode = "system" | "light" | "dark";
export type GitDisplayMode = "simple" | "professional";

export type SidebarNavigationLayout =
  | "bottom-horizontal"
  | "top-horizontal"
  | "top-vertical";

export type SidebarNavigationPlacement = "top" | "bottom";
export type SidebarNavigationOrientation = "horizontal" | "vertical";
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

export const THEME_STORAGE_KEY = "puppyone.desktop.theme";
export const FILE_ICON_THEME_STORAGE_KEY = "puppyone.desktop.fileIconTheme";
export const SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY = "puppyone.desktop.sidebarNavigationLayout";
export const FILES_VISIBILITY_STORAGE_KEY = "puppyone.desktop.filesVisibility";
export const RIGHT_SIDEBAR_TOOLS_STORAGE_KEY = "puppyone.desktop.rightSidebarTools";
export const AI_EDIT_ASSIST_STORAGE_KEY = "puppyone.desktop.aiEditAssist";
export const GIT_DISPLAY_MODE_STORAGE_KEY = "puppyone.desktop.gitDisplayMode";

export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_GIT_DISPLAY_MODE: GitDisplayMode = "simple";
export const DEFAULT_SIDEBAR_NAVIGATION_LAYOUT: SidebarNavigationLayout = "bottom-horizontal";
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
export const DEFAULT_AI_EDIT_ASSIST_ENABLED = false;

export const SIDEBAR_NAVIGATION_LAYOUT_OPTIONS = [
  { value: "bottom-horizontal", label: "Bottom", placement: "bottom" },
  { value: "top-horizontal", label: "Top", placement: "top" },
  { value: "top-vertical", label: "Top Vertical", placement: "top" },
] as const satisfies ReadonlyArray<{
  value: SidebarNavigationLayout;
  label: string;
  placement: SidebarNavigationPlacement;
}>;

export function parseThemeMode(value: string | null | undefined): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : DEFAULT_THEME_MODE;
}

export function parseGitDisplayMode(value: string | null | undefined): GitDisplayMode {
  return value === "professional" || value === "simple" ? value : DEFAULT_GIT_DISPLAY_MODE;
}

export function parseSidebarNavigationLayout(value: string | null | undefined): SidebarNavigationLayout {
  if (value === "bottom") return "bottom-horizontal";
  if (value === "top") return "top-horizontal";
  if (value === "vertical" || value === "bottom-vertical") return "top-vertical";
  return isSidebarNavigationLayout(value) ? value : DEFAULT_SIDEBAR_NAVIGATION_LAYOUT;
}

export function isSidebarNavigationLayout(value: string | null | undefined): value is SidebarNavigationLayout {
  return value === "bottom-horizontal"
    || value === "top-horizontal"
    || value === "top-vertical";
}

export function getSidebarNavigationPlacement(layout: SidebarNavigationLayout): SidebarNavigationPlacement {
  return layout.startsWith("top") ? "top" : "bottom";
}

export function getSidebarNavigationOrientation(layout: SidebarNavigationLayout): SidebarNavigationOrientation {
  return layout.endsWith("vertical") ? "vertical" : "horizontal";
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

export function parseAiEditAssistEnabled(value: string | null | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return DEFAULT_AI_EDIT_ASSIST_ENABLED;
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
