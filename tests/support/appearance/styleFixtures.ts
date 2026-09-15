import { readFileSync } from "node:fs";
import vm from "node:vm";
export function runFirstPaint({
  bootstrap,
  subThemeBootstrap,
  initialTheme,
  interfaceStyle,
  themeMode,
  lightThemePreset,
  darkThemePreset,
  legacyThemePreset,
  appearancePreferences,
  systemDark,
}: {
  bootstrap: string;
  subThemeBootstrap: string;
  initialTheme: string;
  interfaceStyle: string;
  themeMode: string;
  lightThemePreset?: string;
  darkThemePreset?: string;
  legacyThemePreset?: string;
  appearancePreferences?: string;
  systemDark: boolean;
}) {
  const dataset: Record<string, string> = {};
  const properties: Record<string, string> = {};
  const nativeBackgrounds: string[] = [];
  const nativeThemeSources: string[] = [];
  const values = new Map([
    ["puppyone.desktop.interfaceStyle", interfaceStyle],
    ["puppyone.desktop.theme", themeMode],
  ]);
  if (lightThemePreset) values.set("puppyone.desktop.lightThemePreset", lightThemePreset);
  if (darkThemePreset) values.set("puppyone.desktop.darkThemePreset", darkThemePreset);
  if (legacyThemePreset) values.set("puppyone.desktop.themePreset", legacyThemePreset);
  if (appearancePreferences) values.set("puppyone.desktop.appearance", appearancePreferences);
  const context = {
    window: {
      localStorage: { getItem: (key: string) => values.get(key) ?? null },
      matchMedia: () => ({ matches: systemDark }),
      puppyoneDesktop: {
        setWindowBackground: ({
          background,
          themeSource,
        }: {
          background: string;
          themeSource: string;
        }) => {
          nativeBackgrounds.push(background);
          nativeThemeSources.push(themeSource);
        },
      },
    },
    document: {
      documentElement: {
        dataset,
        style: { setProperty: (name: string, value: string) => { properties[name] = value; } },
      },
    },
  };
  vm.runInNewContext(bootstrap, context);
  vm.runInNewContext(subThemeBootstrap, context);
  vm.runInNewContext(initialTheme, context);
  return { dataset, properties, nativeBackgrounds, nativeThemeSources };
}

export function windowsXpStylePack() {
  return [
    "tokens.css",
    "shell.css",
    "controls.css",
    "settings.css",
    "features/explorer.css",
    "surfaces/document.css",
    "surfaces/code.css",
    "surfaces/grid.css",
    "surfaces/editable-table.css",
    "surfaces/editor-controls.css",
    "surfaces/canvas.css",
    "surfaces/media.css",
    "surfaces/embedded.css",
    "features/agent.css",
  ].map((relativePath) => source(`src/styles/interfaces/windows-xp/${relativePath}`)).join("\n");
}

export function source(relativePath: string) {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");
}
