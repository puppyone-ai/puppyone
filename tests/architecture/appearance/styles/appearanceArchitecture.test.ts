import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DARK_THEME_PRESET,
  DEFAULT_LIGHT_THEME_PRESET,
  DEFAULT_LOADING_ANIMATION_PRESET,
  DEFAULT_POINTER_CURSORS,
  DEFAULT_THEME_MODE,
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  type SidebarNavigationLayout,
} from "../../../../src/preferences";
import { DEFAULT_LEGACY_TEXT_SIZE } from "../../../../src/features/appearance/legacyTextSizeMigration";
import {
  APPEARANCE_PREFERENCES_SCHEMA_VERSION,
  readAppearancePreferences,
  serializeAppearancePreferences,
  type LegacyAppearanceSnapshot,
} from "../../../../src/features/appearance/appearancePreferences";
import {
  isAppearanceDecisionLocked,
  isAppearanceValueAllowed,
  resolveAppearance,
  resolveSetting,
} from "../../../../src/features/appearance/resolveAppearance";
import { INTERFACE_STYLES } from "../../../../src/features/appearance/interfaceStyles";
import { BUILTIN_SUB_THEMES } from "../../../../src/features/themes/builtinSubThemes";
import type { SubThemeDefinition } from "../../../../src/features/themes/themeTypes";
import {
  PRESET_VIEWER_MANIFEST,
} from "../../../../packages/shared-ui/src/editor/registry/presetViewerManifest";
import {
  VIEWER_SURFACE_FAMILIES,
} from "../../../../packages/shared-ui/src/editor/registry/viewerContract";

describe("appearance profile architecture", () => {
  it("keeps navigation in the bottom footer for every interface style", () => {
    const requested: SidebarNavigationLayout = "bottom-horizontal";
    const xp = resolveAppearance({
      interfaceStyle: "windows-xp",
      themeMode: "dark",
      sidebarNavigationLayout: requested,
      fileIconTheme: "material",
    });

    expect(xp.decisions.sidebarNavigationLayout).toMatchObject({
      requestedValue: requested,
      effectiveValue: "bottom-horizontal",
      status: "forced",
      source: "style",
    });
    expect(xp.sidebarNavigationPlacement).toBe("bottom");
    expect(xp.sidebarNavigationOrientation).toBe("horizontal");
    expect(xp.themeMode).toBe("light");
    expect(xp.composition.navigation).toBe("sidebar-bottom-footer");
    expect(xp.composition.locationBar).toBe("workspace-path-v1");
    expect(xp.composition.scrollbar).toBe("windows-xp-classic-v1");

    const restored = resolveAppearance({
      interfaceStyle: "default",
      themeMode: "dark",
      sidebarNavigationLayout: requested,
      fileIconTheme: "material",
    });
    expect(restored.sidebarNavigationLayout).toBe(requested);
    expect(restored.composition.locationBar).toBe("none");
    expect(restored.decisions.sidebarNavigationLayout.status).toBe("editable");
  });

  it("keeps allow policies editable while rejecting values outside the curated set", () => {
    const allowed = resolveSetting("large", {
      mode: "allow",
      values: ["small", "medium"],
      default: "medium",
    }, "medium");

    expect(allowed.status).toBe("constrained");
    expect(allowed.effectiveValue).toBe("medium");
    expect(isAppearanceDecisionLocked(allowed)).toBe(false);
    expect(isAppearanceValueAllowed(allowed, "small")).toBe(true);
    expect(isAppearanceValueAllowed(allowed, "large")).toBe(false);
  });

  it("describes resolved Style profiles without a runtime Style × Viewer route table", () => {
    for (const style of INTERFACE_STYLES) {
      expect(style.tokenSet).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(style.profile.family).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(style.profile.variant).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(style.profile.palette).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(style).not.toHaveProperty("surfaceAdapters");
    }
    expect(INTERFACE_STYLES.find(({ id }) => id === "default")?.stylesheet).toBeNull();
    expect(new Set(PRESET_VIEWER_MANIFEST.viewers.map(({ surfaceFamily }) => surfaceFamily)))
      .toEqual(new Set(VIEWER_SURFACE_FAMILIES));
  });

  it("makes Interface Style the only owner of Editor presentation", () => {
    const xp = resolveAppearance({
      interfaceStyle: "windows-xp",
      themeMode: "light",
      sidebarNavigationLayout: "bottom-horizontal",
      fileIconTheme: "default",
    });

    expect(xp.profile).toEqual({ family: "windows-xp", variant: "luna", palette: "blue" });
    expect(xp).not.toHaveProperty("editorPresentation");
    expect(xp.decisions).not.toHaveProperty("editorPresentation");
    expect(INTERFACE_STYLES.find(({ id }) => id === "windows-xp")?.policies)
      .not.toHaveProperty("editorPresentation");
    expect(xp).not.toHaveProperty("surfaceAdapters");
  });

  it("normalizes retired navigation intent, preserves theme intent, and round-trips V6", () => {
    const legacy = legacySnapshot();
    const result = readAppearancePreferences(JSON.stringify({
      schemaVersion: 2,
      activeStyle: "windows-xp",
      shared: {
        sidebarNavigationLayout: "left-vertical",
        themeMode: "dark",
      },
      byStyle: {
        default: { subThemeId: "builtin.pack.github", themeMode: "dark" },
        "windows-xp": { subThemeId: "windows-xp.luna-blue", themeMode: "light" },
      },
      bySurface: { markdown: { headingScale: "large" } },
    }), legacy);

    expect(result.source).toBe("migrated");
    expect(result.writable).toBe(true);
    expect(result.preferences.schemaVersion).toBe(APPEARANCE_PREFERENCES_SCHEMA_VERSION);
    expect(result.preferences.activeRootThemeId).toBe("windows-xp");
    expect(result.preferences.shared.sidebarNavigationLayout).toBe("bottom-horizontal");
    expect(result.preferences.shared).not.toHaveProperty("editorPresentation");
    expect(result.preferences.byRootTheme.default).toEqual({
      requestedColorMode: "dark",
      requestedSubThemeIds: {
        light: "default.github",
        dark: "default.github",
      },
    });
    expect(result.preferences.byRootTheme["windows-xp"]).toEqual({
      requestedColorMode: "light",
      requestedSubThemeIds: {
        light: "windows-xp.luna-blue",
        dark: "windows-xp.luna-blue",
      },
    });
    expect(result.preferences.bySurface.markdown.headingScale).toBe("large");

    const serialized = serializeAppearancePreferences(result.preferences);
    const roundTrip = readAppearancePreferences(serialized, legacy);
    expect(roundTrip.source).toBe("v6");
    expect(roundTrip.preferences).toEqual(result.preferences);
  });

  it("normalizes the version 1 navigation-layout field to the fixed footer", () => {
    const result = readAppearancePreferences(JSON.stringify({
      schemaVersion: 1,
      style: "default",
      navigationLayout: "left-vertical",
      themeMode: "light",
    }), legacySnapshot());

    expect(result.preferences.shared.sidebarNavigationLayout).toBe("bottom-horizontal");
  });

  it("migrates the retired content-size switch into the semantic typography preference", () => {
    const result = readAppearancePreferences(JSON.stringify({
      schemaVersion: 5,
      activeRootThemeId: "default",
      shared: {
        textSize: "large",
        typography: {
          version: 4,
          contentFont: { mode: "follow-theme" },
        },
      },
      byRootTheme: {},
      bySurface: {},
    }), legacySnapshot());

    expect(result.preferences.shared.typography.scale).toBe("large");
    expect(result.preferences.shared).not.toHaveProperty("textSize");
    expect(serializeAppearancePreferences(result.preferences)).not.toContain("textSize");
  });

  it("ignores the retired field once a canonical V6 document has been written", () => {
    const result = readAppearancePreferences(JSON.stringify({
      schemaVersion: 6,
      activeRootThemeId: "default",
      shared: {
        textSize: "large",
        typography: {
          ...DEFAULT_TYPOGRAPHY_PREFERENCES,
          scale: "medium",
        },
        pointerCursors: false,
        loadingAnimationPreset: "ikun",
        fileIconTheme: "default",
        sidebarNavigationLayout: "bottom-horizontal",
      },
      byRootTheme: {},
      bySurface: {},
    }), legacySnapshot());

    expect(result.source).toBe("v6");
    expect(result.preferences.shared.typography.scale).toBe("medium");
    expect(result.preferences.shared).not.toHaveProperty("textSize");
  });

  it("migrates the retired branded file-icon theme ID inside a canonical document", () => {
    const result = readAppearancePreferences(JSON.stringify({
      schemaVersion: 6,
      activeRootThemeId: "default",
      shared: {
        typography: DEFAULT_TYPOGRAPHY_PREFERENCES,
        pointerCursors: false,
        loadingAnimationPreset: "ikun",
        fileIconTheme: "vscode",
        sidebarNavigationLayout: "bottom-horizontal",
      },
      byRootTheme: {},
      bySurface: {},
    }), legacySnapshot());

    expect(result.preferences.shared.fileIconTheme).toBe("semantic");
    expect(serializeAppearancePreferences(result.preferences)).not.toContain('"vscode"');
  });

  it("migrates legacy Light and Dark presets into independent Sub Theme memories", () => {
    const result = readAppearancePreferences(null, {
      ...legacySnapshot(),
      lightThemePreset: "warm",
      darkThemePreset: "graphite",
    });

    expect(result.preferences.byRootTheme.default.requestedSubThemeIds).toEqual({
      light: "default.warm",
      dark: "default.graphite",
    });
  });

  it("resolves the remembered Sub Theme after resolving the effective Color Mode", () => {
    const requestedSubThemeIds = {
      light: "default.github",
      dark: "default.newspaper",
    } as const;
    const shared = {
      interfaceStyle: "default" as const,
      requestedSubThemeIds,
      sidebarNavigationLayout: "bottom-horizontal" as const,
      fileIconTheme: "default" as const,
    };

    expect(resolveAppearance({ ...shared, themeMode: "light" }).subThemeId)
      .toBe("default.github");
    expect(resolveAppearance({ ...shared, themeMode: "dark" }).subThemeId)
      .toBe("default.newspaper");
    expect(resolveAppearance({
      ...shared,
      themeMode: "system",
      systemColorMode: "dark",
    }).subThemeId).toBe("default.newspaper");
  });

  it("resolves requested and effective Sub Themes without leaking identity into editors", () => {
    const incompatible = subTheme({
      id: "external.xp-only",
      compatibleRootThemeIds: ["windows-xp"],
      variants: { light: { compiledCss: {} } },
      targets: ["markdown", "csv"],
    });
    const result = resolveAppearance({
      interfaceStyle: "default",
      themeMode: "dark",
      requestedSubThemeIds: { light: incompatible.id, dark: incompatible.id },
      subThemeCatalog: {
        subThemes: [...BUILTIN_SUB_THEMES, incompatible],
        diagnostics: [],
      },
      sidebarNavigationLayout: "bottom-horizontal",
      fileIconTheme: "default",
    });

    expect(result.decisions.subTheme).toMatchObject({
      requestedValue: incompatible.id,
      effectiveValue: "default.neutral",
      status: "constrained",
    });
    expect(result.diagnostics[0]?.code).toBe("sub-theme-incompatible");
    expect(result.appearanceRevision).toBe("default:default.neutral:dark");

    const editorContext = source("packages/shared-ui/src/core/appearance/EditorAppearanceContext.tsx");
    expect(editorContext).toContain("EditorAppearanceRevisionContext");
    expect(editorContext).toContain("revision: string");
    expect(editorContext).not.toMatch(/ThemeCatalog|SubThemeDefinition|rootThemeId|subThemeId/);
  });

  it("resolves system Color Mode before checking Sub Theme mode compatibility", () => {
    const lightOnly = subTheme({
      id: "external.light-reader",
      compatibleRootThemeIds: ["default"],
      variants: { light: { compiledCss: {} } },
    });
    const result = resolveAppearance({
      interfaceStyle: "default",
      themeMode: "system",
      systemColorMode: "dark",
      requestedSubThemeIds: { light: lightOnly.id, dark: lightOnly.id },
      subThemeCatalog: {
        subThemes: [...BUILTIN_SUB_THEMES, lightOnly],
        diagnostics: [],
      },
      sidebarNavigationLayout: "bottom-horizontal",
      fileIconTheme: "default",
    });

    expect(result.requestedColorMode).toBe("system");
    expect(result.effectiveColorMode).toBe("dark");
    expect(result.subThemeId).toBe("default.neutral");
    expect(result.diagnostics[0]?.code).toBe("sub-theme-mode-unsupported");
  });

  it("renders Color Mode and Sub Theme before the Root Theme footer", () => {
    const settings = source("src/features/settings/SettingsView.tsx");
    expectInOrder(settings, [
      "<InterfacePaletteSettings",
      "<SubThemeSettingsSection",
      "<InterfaceStyleSetting",
    ]);
  });

  it("does not authorize overwriting a newer unsupported preference document", () => {
    const result = readAppearancePreferences(JSON.stringify({
      schemaVersion: 99,
      activeStyle: "future-style",
      shared: {},
    }), legacySnapshot());

    expect(result.source).toBe("future");
    expect(result.writable).toBe(false);
    expect(result.preferences.activeRootThemeId).toBe("default");
  });

  it("keeps Settings and Shell on the shared resolver rather than Style-ID branches", () => {
    const settings = source("src/features/settings/SettingsView.tsx");
    const typographySettings = source("src/features/settings/main/TypographySettingsView.tsx");
    const preferences = source("src/features/app-shell/useDesktopPreferences.ts");
    const shell = source("src/features/app-shell/DesktopDataWorkspaceSurface.tsx");

    expect(preferences).toContain("resolveAppearance({");
    expect(settings).not.toContain("resolvedAppearance.decisions.sidebarNavigationLayout");
    expect(settings).not.toContain("onSidebarNavigationLayoutChange");
    expect(settings).not.toContain("settings.appearance.navigation.title");
    expect(settings).not.toContain("<TypographyScaleSetting");
    expect(typographySettings).toContain("<TypographyScaleSetting");
    expect(typographySettings).toContain("preferences={typographyPreferences}");
    expect(settings).not.toContain("onLegacyContentSizeChange");
    expect(settings).toContain("resolvedAppearance.decisions.fileIconTheme");
    expect(settings).not.toContain("editorPresentation");
    expect(preferences).not.toContain("editorPresentation");
    expect(settings).not.toContain("dockIcon");
    expect(preferences).not.toContain("dockIcon");
    expect(shell).toContain('? "bottom"');
    expect(shell).not.toContain("preferences.sidebarNavigationPlacement");
    expect(settings).not.toMatch(/interfaceStyle\s*===\s*["']windows-xp["']/);
    expect(shell).not.toMatch(/interfaceStyle\s*===\s*["']windows-xp["']/);
  });

  it("keeps the retired text-size channel inside the v5 migration boundary only", () => {
    for (const file of [
      "src/features/appearance/resolveAppearance.ts",
      "src/features/appearance/AppearanceRuntime.tsx",
      "src/features/appearance/interface-style-manifest.json",
      "src/features/app-shell/DesktopOverlayPortal.tsx",
      "src/features/settings/types.ts",
      "src/features/settings/SettingsWorkspaceSurface.tsx",
    ]) {
      const contents = source(file);
      expect(contents, file).not.toMatch(/\btextSize\b|data-content-text-size|contentTextSize/);
    }

    const migration = source("src/features/appearance/appearancePreferences.ts");
    expect(migration).toContain("shared.textSize");
    expect(migration).toContain("migrateLegacyContentSize");
    expect(migration).toContain("APPEARANCE_PREFERENCES_SCHEMA_VERSION = 6");
  });

  it("keeps the Dock icon fixed to the canonical product asset", () => {
    const main = source("electron/main.mjs");
    const systemIpc = source("electron/main/ipc/system-ipc.mjs");
    const preload = source("electron/preload.cjs");
    const packageMetadata = source("package.json");
    const buildPreparation = source("scripts/release-support/desktop-build-preparation.mjs");
    const packagedVerifier = source("scripts/release-support/packaged-desktop-build-verifier.mjs");

    expect(main).toContain("setDevelopmentDockIcon({");
    expect(main).not.toContain("app.dock.setIcon");
    expect(systemIpc).not.toContain("set-dock-icon");
    expect(preload).not.toContain("setDockIcon");
    expect(packageMetadata).not.toContain("dock-icon-light");
    expect(packageMetadata).not.toContain("dock-icon-matte");
    expect(buildPreparation).not.toContain("dock-icon-light");
    expect(buildPreparation).not.toContain("dock-icon-matte");
    expect(packagedVerifier).not.toContain("dock-icon-light");
    expect(packagedVerifier).not.toContain("dock-icon-matte");
  });

  it("loads the XP pack as modules in the dedicated cascade layer", () => {
    const cascade = source("src/styles/cascade.css");
    const generated = source("src/styles/interface-styles.generated.css");
    const entry = source("src/styles/interfaces/windows-xp/index.css");

    expect(cascade).toContain(
      "features, interface-style, sub-theme, appearance-overrides, accessibility, overrides",
    );
    expect(generated).toContain(
      '@import "./interfaces/windows-xp/index.css" layer(interface-style);',
    );
    for (const module of [
      "tokens.css",
      "shell.css",
      "controls.css",
      "settings.css",
      "features/explorer.css",
      "features/agent.css",
      "surfaces/document.css",
      "surfaces/code.css",
      "surfaces/grid.css",
      "surfaces/editable-table.css",
      "surfaces/canvas.css",
      "surfaces/media.css",
      "surfaces/embedded.css",
    ]) {
      expect(entry, module).toContain(`@import "./${module}";`);
    }
  });

  it("gates the representative visual matrix in CI", () => {
    const packageMetadata = JSON.parse(source("package.json"));
    const workflow = source(".github/workflows/ci.yml");
    const harness = source("src/features/appearance/AppearanceVisualSmokeHarness.tsx");
    const smoke = source("tests/integration/appearance/themes/appearance-visual-matrix.smoke.mjs");

    expect(packageMetadata.scripts["smoke:appearance-visual"].split(" && ")).toContain(
      "electron tests/integration/appearance/themes/appearance-visual-matrix.smoke.mjs",
    );
    const checks = JSON.parse(source("scripts/release-checks/checks.json")).checks;
    expect(checks.find((check: { id: string }) => check.id === "appearance")).toMatchObject({
      group: "app", command: ["npm", "run", "smoke:appearance-visual"], dependsOn: ["build"],
    });
    expect(workflow).toContain("npm run check:release -- --group app");
    expect(harness).toContain('data-appearance-visual-ready="true"');
    expect(smoke).toContain('const styles = ["default", "windows-xp"]');
    for (const family of VIEWER_SURFACE_FAMILIES) expect(harness).toContain(`"${family}"`);
  });

  it("restarts the dev renderer when a Style Pack import graph changes", () => {
    const devOrchestrator = source("scripts/dev-electron.mjs");

    expect(devOrchestrator).toContain("startRendererStyleGraphWatcher()");
    expect(devOrchestrator).toContain("watchInterfaceStyleGraph(");
    expect(devOrchestrator).toContain("Interface Style import graph changed");
    expect(devOrchestrator).toContain("stopRendererStyleGraphWatcher()");
  });
});

function legacySnapshot(): LegacyAppearanceSnapshot {
  return {
    activeStyle: "default",
    themeMode: DEFAULT_THEME_MODE,
    lightThemePreset: DEFAULT_LIGHT_THEME_PRESET,
    darkThemePreset: DEFAULT_DARK_THEME_PRESET,
    legacyTextSize: DEFAULT_LEGACY_TEXT_SIZE,
    typography: DEFAULT_TYPOGRAPHY_PREFERENCES,
    pointerCursors: DEFAULT_POINTER_CURSORS,
    loadingAnimationPreset: DEFAULT_LOADING_ANIMATION_PRESET,
    fileIconTheme: "default",
    sidebarNavigationLayout: "bottom-horizontal",
  };
}

function source(relativePath: string) {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}

function expectInOrder(sourceText: string, needles: readonly string[]) {
  let cursor = -1;
  for (const needle of needles) {
    const next = sourceText.indexOf(needle, cursor + 1);
    expect(next, needle).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function subTheme(overrides: Partial<SubThemeDefinition>): SubThemeDefinition {
  return {
    id: "external.reader",
    family: "external",
    name: "Reader",
    version: "1.0.0",
    contractVersion: 1,
    compatibleRootThemeIds: ["default"],
    targets: ["application", "markdown", "csv"],
    source: "local-package",
    variants: {
      light: { compiledCss: {} },
      dark: { compiledCss: {} },
    },
    ...overrides,
  };
}
