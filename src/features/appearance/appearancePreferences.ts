import { parseFileIconThemeId, type FileIconThemeId } from "@puppyone/shared-ui";
import {
  parseLoadingAnimationPreset,
  parsePointerCursors,
  parseSidebarNavigationLayout,
  parseThemeMode,
  parseTypography,
  type DarkThemePreset,
  type LightThemePreset,
  type LoadingAnimationPreset,
  type SidebarNavigationLayout,
  type ThemeMode,
  type TypographyPreferences,
} from "../../preferences";
import {
  DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
  parseMarkdownPresentationSettings,
  type MarkdownPresentationSettings,
} from "../markdown/markdownPresentation";
import {
  APPEARANCE_PREFERENCES_STORAGE_KEY,
  getDefaultSubThemeId,
  isInterfaceStyle,
  parseInterfaceStyle,
  type InterfaceStyle,
  type ResolvedTheme,
} from "./interfaceStyles";
import { isSubThemeId, normalizeSubThemeId } from "../themes/subThemePreferences";
import { withTypographyScale } from "../typography";
import {
  parseLegacyTextSize,
  type LegacyTextSize,
} from "./legacyTextSizeMigration";

export { APPEARANCE_PREFERENCES_STORAGE_KEY };

export const APPEARANCE_PREFERENCES_SCHEMA_VERSION = 6 as const;

export type AppearanceSharedPreferences = Readonly<{
  typography: TypographyPreferences;
  pointerCursors: boolean;
  loadingAnimationPreset: LoadingAnimationPreset;
  fileIconTheme: FileIconThemeId;
  sidebarNavigationLayout: SidebarNavigationLayout;
}>;

export type RootThemeAppearancePreferences = Readonly<{
  requestedColorMode: ThemeMode;
  requestedSubThemeIds: Readonly<Record<ResolvedTheme, string>>;
}>;

export type AppearanceSurfaceOverridePreferences = Readonly<{
  markdown: MarkdownPresentationSettings;
}>;

export type AppearancePreferencesV6 = Readonly<{
  schemaVersion: typeof APPEARANCE_PREFERENCES_SCHEMA_VERSION;
  activeRootThemeId: InterfaceStyle;
  shared: AppearanceSharedPreferences;
  byRootTheme: Readonly<Record<string, RootThemeAppearancePreferences>>;
  bySurface: AppearanceSurfaceOverridePreferences;
}>;

export type LegacyAppearanceSnapshot = Readonly<{
  activeStyle: InterfaceStyle;
  themeMode: ThemeMode;
  lightThemePreset: LightThemePreset;
  darkThemePreset: DarkThemePreset;
  legacySubThemeId?: string | null;
  markdownPresentation?: MarkdownPresentationSettings;
  legacyTextSize: LegacyTextSize;
  typography: TypographyPreferences;
  pointerCursors: boolean;
  loadingAnimationPreset: LoadingAnimationPreset;
  fileIconTheme: FileIconThemeId;
  sidebarNavigationLayout: SidebarNavigationLayout;
}>;

export type AppearancePreferencesReadResult = Readonly<{
  preferences: AppearancePreferencesV6;
  source: "v6" | "migrated" | "legacy" | "future";
  writable: boolean;
}>;

export function readAppearancePreferences(
  serialized: string | null | undefined,
  legacy: LegacyAppearanceSnapshot,
): AppearancePreferencesReadResult {
  if (!serialized) {
    return { preferences: fromLegacy(legacy), source: "legacy", writable: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { preferences: fromLegacy(legacy), source: "migrated", writable: true };
  }
  if (!isRecord(parsed)) {
    return { preferences: fromLegacy(legacy), source: "migrated", writable: true };
  }

  if (
    typeof parsed.schemaVersion === "number"
    && parsed.schemaVersion > APPEARANCE_PREFERENCES_SCHEMA_VERSION
  ) {
    return { preferences: fromLegacy(legacy), source: "future", writable: false };
  }

  return {
    preferences: parsed.schemaVersion === APPEARANCE_PREFERENCES_SCHEMA_VERSION
      ? normalizeV6(parsed, legacy)
      : migrateLegacyDocument(parsed, legacy),
    source: parsed.schemaVersion === APPEARANCE_PREFERENCES_SCHEMA_VERSION ? "v6" : "migrated",
    writable: true,
  };
}

export function serializeAppearancePreferences(preferences: AppearancePreferencesV6): string {
  return JSON.stringify(preferences);
}

export function createAppearancePreferencesV6(input: {
  activeRootThemeId: InterfaceStyle;
  shared: AppearanceSharedPreferences;
  byRootTheme: Readonly<Record<string, RootThemeAppearancePreferences>>;
  bySurface?: Partial<AppearanceSurfaceOverridePreferences>;
}): AppearancePreferencesV6 {
  return Object.freeze({
    schemaVersion: APPEARANCE_PREFERENCES_SCHEMA_VERSION,
    activeRootThemeId: input.activeRootThemeId,
    shared: Object.freeze({ ...input.shared }),
    byRootTheme: freezeRootThemePreferences(input.byRootTheme),
    bySurface: Object.freeze({
      markdown: Object.freeze({
        ...(input.bySurface?.markdown ?? DEFAULT_MARKDOWN_PRESENTATION_SETTINGS),
      }),
    }),
  });
}

function fromLegacy(legacy: LegacyAppearanceSnapshot): AppearancePreferencesV6 {
  const activeRootThemeId = legacy.activeStyle;
  return createAppearancePreferencesV6({
    activeRootThemeId,
    shared: sharedFromLegacy(legacy),
    byRootTheme: createDefaultRootThemePreferences({
      activeRootThemeId,
      requestedColorMode: legacy.themeMode,
      requestedSubThemeIds: resolveLegacyDefaultSubThemes(legacy),
    }),
    bySurface: {
      markdown: legacy.markdownPresentation ?? DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
    },
  });
}

function migrateLegacyDocument(
  input: Record<string, unknown>,
  legacy: LegacyAppearanceSnapshot,
): AppearancePreferencesV6 {
  const shared = isRecord(input.shared) ? input.shared : input;
  const activeRootThemeId = parseInterfaceStyle(
    asString(input.activeRootThemeId)
      ?? asString(input.activeStyle)
      ?? asString(input.style)
      ?? legacy.activeStyle,
  );
  const requestedColorMode = parseThemeMode(asString(shared.themeMode) ?? legacy.themeMode);
  const requestedSubThemeIds = resolveLegacyDefaultSubThemes({
    ...legacy,
    themeMode: requestedColorMode,
    lightThemePreset: parseLegacyLightPreset(shared.lightThemePreset, legacy.lightThemePreset),
    darkThemePreset: parseLegacyDarkPreset(shared.darkThemePreset, legacy.darkThemePreset),
  });
  const legacyByRoot = isRecord(input.byRootTheme)
    ? readRootThemePreferences(input.byRootTheme, requestedColorMode, requestedSubThemeIds)
    : readLegacyByStyle(input.byStyle, requestedColorMode, requestedSubThemeIds);
  const bySurface = isRecord(input.bySurface) ? input.bySurface : {};
  const serializedLegacyTextSize = asString(shared.textSize);

  return createAppearancePreferencesV6({
    activeRootThemeId,
    shared: normalizeShared(
      {
        ...shared,
        sidebarNavigationLayout: shared.sidebarNavigationLayout ?? input.navigationLayout,
      },
      legacy,
      serializedLegacyTextSize === undefined
        ? undefined
        : parseLegacyTextSize(serializedLegacyTextSize),
    ),
    byRootTheme: {
      ...createDefaultRootThemePreferences({
        activeRootThemeId,
        requestedColorMode,
        requestedSubThemeIds,
      }),
      ...legacyByRoot,
    },
    bySurface: {
      markdown: readMarkdownOverrides(bySurface.markdown, legacy.markdownPresentation),
    },
  });
}

function normalizeV6(
  input: Record<string, unknown>,
  legacy: LegacyAppearanceSnapshot,
): AppearancePreferencesV6 {
  const activeRootThemeId = parseInterfaceStyle(
    asString(input.activeRootThemeId) ?? legacy.activeStyle,
  );
  const shared = isRecord(input.shared) ? input.shared : {};
  const bySurface = isRecord(input.bySurface) ? input.bySurface : {};
  const fallbackMode = legacy.themeMode;
  const fallbackSubThemeIds = resolveLegacyDefaultSubThemes(legacy);
  const normalizedRoots = readRootThemePreferences(
    input.byRootTheme,
    fallbackMode,
    fallbackSubThemeIds,
  );

  return createAppearancePreferencesV6({
    activeRootThemeId,
    shared: normalizeShared(shared, legacy),
    byRootTheme: {
      ...createDefaultRootThemePreferences({
        activeRootThemeId,
        requestedColorMode: fallbackMode,
        requestedSubThemeIds: fallbackSubThemeIds,
      }),
      ...normalizedRoots,
    },
    bySurface: {
      markdown: readMarkdownOverrides(bySurface.markdown, legacy.markdownPresentation),
    },
  });
}

function normalizeShared(
  shared: Record<string, unknown>,
  legacy: LegacyAppearanceSnapshot,
  legacyTextSize?: LegacyTextSize,
): AppearanceSharedPreferences {
  const rawFileIconTheme = typeof shared.fileIconTheme === "string" ? shared.fileIconTheme : null;
  const parsedTypography = parseTypography(
    shared.typography === undefined
      ? JSON.stringify(legacy.typography)
      : JSON.stringify(shared.typography),
  );
  const typography = legacyTextSize
    ? migrateLegacyContentSize(parsedTypography, legacyTextSize)
    : parsedTypography;
  return {
    typography,
    pointerCursors: typeof shared.pointerCursors === "boolean"
      ? shared.pointerCursors
      : parsePointerCursors(String(legacy.pointerCursors)),
    loadingAnimationPreset: parseLoadingAnimationPreset(
      asString(shared.loadingAnimationPreset) ?? legacy.loadingAnimationPreset,
    ),
    fileIconTheme: parseFileIconThemeId(rawFileIconTheme) ?? legacy.fileIconTheme,
    sidebarNavigationLayout: parseSidebarNavigationLayout(
      asString(shared.sidebarNavigationLayout) ?? legacy.sidebarNavigationLayout,
    ),
  };
}

function sharedFromLegacy(legacy: LegacyAppearanceSnapshot): AppearanceSharedPreferences {
  return {
    typography: migrateLegacyContentSize(legacy.typography, legacy.legacyTextSize),
    pointerCursors: legacy.pointerCursors,
    loadingAnimationPreset: legacy.loadingAnimationPreset,
    fileIconTheme: legacy.fileIconTheme,
    sidebarNavigationLayout: legacy.sidebarNavigationLayout,
  };
}

function migrateLegacyContentSize(
  typography: TypographyPreferences,
  legacyTextSize: LegacyTextSize,
): TypographyPreferences {
  if (legacyTextSize === "default") return typography;
  return withTypographyScale(typography, legacyTextSize === "small" ? "small" : "large");
}

function createDefaultRootThemePreferences({
  activeRootThemeId,
  requestedColorMode,
  requestedSubThemeIds,
}: {
  activeRootThemeId: InterfaceStyle;
  requestedColorMode: ThemeMode;
  requestedSubThemeIds: Readonly<Record<ResolvedTheme, string>>;
}): Record<string, RootThemeAppearancePreferences> {
  return {
    default: {
      requestedColorMode: activeRootThemeId === "default" ? requestedColorMode : "system",
      requestedSubThemeIds: activeRootThemeId === "default"
        ? requestedSubThemeIds
        : createRootDefaultSubThemeIds("default"),
    },
    "windows-xp": {
      requestedColorMode: activeRootThemeId === "windows-xp" ? requestedColorMode : "light",
      requestedSubThemeIds: createRootDefaultSubThemeIds("windows-xp"),
    },
  };
}

function readRootThemePreferences(
  input: unknown,
  fallbackMode: ThemeMode,
  fallbackSubThemeIds: Readonly<Record<ResolvedTheme, string>>,
): Record<string, RootThemeAppearancePreferences> {
  if (!isRecord(input)) return {};
  return Object.fromEntries(Object.entries(input).flatMap(([rootThemeId, value]) => {
    if (!isRecord(value)) return [];
    const defaults = isInterfaceStyle(rootThemeId)
      ? createRootDefaultSubThemeIds(rootThemeId)
      : fallbackSubThemeIds;
    const legacyId = parseSubThemeId(value.requestedSubThemeId ?? value.subThemeId);
    const rawByMode = isRecord(value.requestedSubThemeIds) ? value.requestedSubThemeIds : {};
    const light = parseSubThemeId(rawByMode.light) ?? legacyId ?? defaults.light;
    const dark = parseSubThemeId(rawByMode.dark) ?? legacyId ?? defaults.dark;
    return [[rootThemeId, {
      requestedColorMode: parseThemeMode(asString(value.requestedColorMode) ?? fallbackMode),
      requestedSubThemeIds: Object.freeze({ light, dark }),
    }]];
  }));
}

function readLegacyByStyle(
  input: unknown,
  fallbackMode: ThemeMode,
  fallbackSubThemeIds: Readonly<Record<ResolvedTheme, string>>,
): Record<string, RootThemeAppearancePreferences> {
  if (!isRecord(input)) return {};
  return readRootThemePreferences(Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (!isRecord(value)) return [key, value];
    return [key, {
      requestedSubThemeId: value.requestedSubThemeId ?? value.subThemeId,
      requestedColorMode: value.requestedColorMode ?? value.themeMode ?? fallbackMode,
    }];
  })), fallbackMode, fallbackSubThemeIds);
}

function readMarkdownOverrides(
  input: unknown,
  fallback = DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
): MarkdownPresentationSettings {
  if (!isRecord(input)) return fallback;
  return parseMarkdownPresentationSettings(JSON.stringify({ version: 2, ...input }));
}

function resolveLegacyDefaultSubThemes(
  legacy: LegacyAppearanceSnapshot,
): Readonly<Record<ResolvedTheme, string>> {
  if (legacy.legacySubThemeId) {
    const normalized = normalizeSubThemeId(legacy.legacySubThemeId);
    if (isSubThemeId(normalized)) return Object.freeze({ light: normalized, dark: normalized });
  }
  return Object.freeze({
    light: legacy.lightThemePreset === "warm"
      ? "default.warm"
      : legacy.lightThemePreset === "graphite"
        ? "default.graphite"
        : getDefaultSubThemeId("default", "light"),
    dark: legacy.darkThemePreset === "warm"
      ? "default.warm"
      : legacy.darkThemePreset === "graphite"
        ? "default.graphite"
        : getDefaultSubThemeId("default", "dark"),
  });
}

function createRootDefaultSubThemeIds(
  rootThemeId: InterfaceStyle,
): Readonly<Record<ResolvedTheme, string>> {
  return Object.freeze({
    light: getDefaultSubThemeId(rootThemeId, "light"),
    dark: getDefaultSubThemeId(rootThemeId, "dark"),
  });
}

function parseSubThemeId(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const normalized = normalizeSubThemeId(raw);
  return isSubThemeId(normalized) ? normalized : null;
}

function parseLegacyLightPreset(value: unknown, fallback: LightThemePreset): LightThemePreset {
  return value === "neutral" || value === "warm" || value === "graphite" ? value : fallback;
}

function parseLegacyDarkPreset(value: unknown, fallback: DarkThemePreset): DarkThemePreset {
  return value === "default" || value === "warm" || value === "graphite" ? value : fallback;
}

function freezeRootThemePreferences(
  input: Readonly<Record<string, RootThemeAppearancePreferences>>,
): Readonly<Record<string, RootThemeAppearancePreferences>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, Object.freeze({
      ...value,
      requestedSubThemeIds: Object.freeze({ ...value.requestedSubThemeIds }),
    })]),
  ));
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}

function asString(input: unknown): string | null {
  return typeof input === "string" ? input : null;
}
