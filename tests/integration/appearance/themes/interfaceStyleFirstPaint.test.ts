import { describe, expect, it } from "vitest";
import {
  INTERFACE_STYLES,
  getInterfaceStyleFirstPaint,
  resolveActiveThemeMode
} from "../../../../src/features/appearance/interfaceStyles";
import { BUILTIN_SUB_THEMES } from "../../../../src/features/themes/builtinSubThemes";
import { runFirstPaint, source } from "../../../support/appearance/styleFixtures";

describe("Interface style registry", () => {
  it("uses the same generated manifest for first paint and the React runtime", () => {
    const bootstrap = source("public/interface-style-bootstrap.js");
    const subThemeBootstrap = source("public/sub-theme-bootstrap.js");
    const initialTheme = source("public/initial-theme.js");
    const index = source("index.html");
    const bootstrapIndex = index.indexOf('/interface-style-bootstrap.js');
    const subThemeBootstrapIndex = index.indexOf('/sub-theme-bootstrap.js');
    const resolverIndex = index.indexOf('/initial-theme.js');

    expect(bootstrapIndex).toBeGreaterThan(0);
    expect(subThemeBootstrapIndex).toBeGreaterThan(bootstrapIndex);
    expect(resolverIndex).toBeGreaterThan(subThemeBootstrapIndex);
    expect(initialTheme).not.toContain('"windows-xp"');
    expect(initialTheme).not.toContain("editorPresentation");

    for (const style of INTERFACE_STYLES) {
      const requestedMode = "dark";
      const activeMode = resolveActiveThemeMode(style.id, requestedMode);
      const resolvedTheme = activeMode === "system" ? "dark" : activeMode;
      const defaults: Partial<Record<"light" | "dark", string>> = style.subThemes.defaultSubThemeIds;
      const defaultSubThemeId = defaults[resolvedTheme];
      const subTheme = BUILTIN_SUB_THEMES.find(({ id }) => id === defaultSubThemeId);
      const expectedPaint = getInterfaceStyleFirstPaint(style.id, resolvedTheme, subTheme);
      const result = runFirstPaint({
        bootstrap,
        subThemeBootstrap,
        initialTheme,
        interfaceStyle: style.id,
        themeMode: requestedMode,
        systemDark: true,
      });

      expect(result.dataset.interfaceStyle).toBe(style.id);
      expect(result.dataset.interfaceStyleFamily).toBe(style.profile.family);
      expect(result.dataset.interfaceStyleVariant).toBe(style.profile.variant);
      expect(result.dataset.interfaceStylePalette).toBe(style.profile.palette);
      expect(result.dataset).not.toHaveProperty("editorPresentation");
      expect(result.dataset.initialTheme).toBe(resolvedTheme);
      expect(result.properties["--initial-shell-background"]).toBe(expectedPaint.background);
      expect(result.properties["--initial-shell-color-scheme"]).toBe(expectedPaint.colorScheme);
    }
  });

  it("paints the persisted editor palette before React instead of flashing the warm fallback", () => {
    const bootstrap = source("public/interface-style-bootstrap.js");
    const subThemeBootstrap = source("public/sub-theme-bootstrap.js");
    const initialTheme = source("public/initial-theme.js");
    const initialShell = source("public/initial-shell.css");
    const cases = [
      { themeMode: "light", preset: "neutral", subThemeId: "default.neutral", expected: "#fafafa" },
      { themeMode: "light", preset: "warm", subThemeId: "default.warm", expected: "#fbfaf7" },
      { themeMode: "light", preset: "graphite", subThemeId: "default.graphite", expected: "#fbfbfc" },
      { themeMode: "dark", preset: "default", subThemeId: "default.neutral", expected: "#161413" },
      { themeMode: "dark", preset: "warm", subThemeId: "default.warm", expected: "#18130f" },
      { themeMode: "dark", preset: "graphite", subThemeId: "default.graphite", expected: "#17181c" },
    ] as const;

    expect(initialShell).toContain("--initial-shell-background: #fafafa");
    expect(initialShell).not.toContain("--initial-shell-background: #f1eadf");

    for (const item of cases) {
      const result = runFirstPaint({
        bootstrap,
        subThemeBootstrap,
        initialTheme,
        interfaceStyle: "default",
        themeMode: item.themeMode,
        lightThemePreset: item.themeMode === "light" ? item.preset : undefined,
        darkThemePreset: item.themeMode === "dark" ? item.preset : undefined,
        systemDark: false,
      });
      expect(result.dataset.initialSubThemeId).toBe(item.subThemeId);
      expect(result.properties["--initial-shell-background"]).toBe(item.expected);
      expect(result.nativeBackgrounds).toEqual([item.expected]);
      expect(result.nativeThemeSources).toEqual([item.themeMode]);
      const subTheme = BUILTIN_SUB_THEMES.find(({ id }) => id === item.subThemeId);
      expect(getInterfaceStyleFirstPaint("default", item.themeMode, subTheme).background)
        .toBe(item.expected);
    }

    const defaultLight = runFirstPaint({
      bootstrap,
      subThemeBootstrap,
      initialTheme,
      interfaceStyle: "default",
      themeMode: "light",
      systemDark: false,
    });
    expect(defaultLight.dataset.initialSubThemeId).toBe("default.neutral");
    expect(defaultLight.properties["--initial-shell-background"]).toBe("#fafafa");

    const systemLight = runFirstPaint({
      bootstrap,
      subThemeBootstrap,
      initialTheme,
      interfaceStyle: "default",
      themeMode: "system",
      systemDark: false,
    });
    expect(systemLight.nativeThemeSources).toEqual(["system"]);

    const invalidPreset = runFirstPaint({
      bootstrap,
      subThemeBootstrap,
      initialTheme,
      interfaceStyle: "default",
      themeMode: "light",
      lightThemePreset: "__proto__",
      systemDark: false,
    });
    expect(invalidPreset.dataset.initialSubThemeId).toBe("default.neutral");
    expect(invalidPreset.properties["--initial-shell-background"]).toBe("#fafafa");

    const v5Selection = runFirstPaint({
      bootstrap,
      subThemeBootstrap,
      initialTheme,
      interfaceStyle: "default",
      themeMode: "light",
      appearancePreferences: JSON.stringify({
        schemaVersion: 5,
        activeRootThemeId: "default",
        byRootTheme: {
          default: {
            requestedColorMode: "dark",
            requestedSubThemeIds: { light: "default.github", dark: "default.github" },
          },
        },
      }),
      systemDark: false,
    });
    expect(v5Selection.dataset.initialSubThemeId).toBe("default.github");
    expect(v5Selection.properties["--initial-shell-background"]).toBe("#0d1117");

    const damagedSelection = runFirstPaint({
      bootstrap,
      subThemeBootstrap,
      initialTheme,
      interfaceStyle: "default",
      themeMode: "light",
      appearancePreferences: JSON.stringify({
        schemaVersion: 4,
        activeRootThemeId: "default",
        byRootTheme: {
          default: {
            requestedColorMode: "light",
            requestedSubThemeIds: { light: "local.broken", dark: "local.broken" },
          },
        },
      }),
      systemDark: false,
    });
    expect(damagedSelection.dataset.initialSubThemeId).toBe("local.broken");
    expect(damagedSelection.properties["--initial-shell-background"]).toBe("#fafafa");
  });

  it("honors the legacy light-preset key during first-paint migration", () => {
    const result = runFirstPaint({
      bootstrap: source("public/interface-style-bootstrap.js"),
      subThemeBootstrap: source("public/sub-theme-bootstrap.js"),
      initialTheme: source("public/initial-theme.js"),
      interfaceStyle: "default",
      themeMode: "light",
      legacyThemePreset: "warm",
      systemDark: false,
    });

    expect(result.dataset.initialSubThemeId).toBe("default.warm");
    expect(result.properties["--initial-shell-background"]).toBe("#fbfaf7");
  });
});
