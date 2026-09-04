// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_PREFERENCES_STORAGE_KEY,
  type AppearancePreferencesV6,
} from "../src/features/appearance/appearancePreferences";
import { LEGACY_APPEARANCE_STORAGE_KEYS } from "../src/features/appearance/legacyAppearancePreferences";
import { LEGACY_SURFACE_THEME_PREFERENCES_STORAGE_KEY } from "../src/features/themes/subThemePreferences";
import { BUILTIN_FONT_IDS } from "../src/features/typography";
import { TYPOGRAPHY_STORAGE_KEY } from "../src/preferences";
import {
  useDesktopPreferences,
  type DesktopPreferencesController,
} from "../src/features/app-shell/useDesktopPreferences";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let latest: DesktopPreferencesController | null;

beforeEach(() => {
  latest = null;
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
});

describe("desktop appearance preferences", () => {
  it("persists one canonical V6 document and remembers Sub Themes independently by mode and Root Theme", () => {
    act(() => root.render(<Harness />));

    act(() => {
      latest?.setSubThemeId("default.github");
      latest?.setThemeMode("dark");
    });
    expect(readStored().byRootTheme.default).toEqual({
      requestedColorMode: "dark",
      requestedSubThemeIds: {
        light: "default.github",
        dark: "default.neutral",
      },
    });
    expect(latest?.requestedSubThemeId).toBe("default.neutral");

    act(() => latest?.setSubThemeId("default.newspaper"));
    expect(readStored().byRootTheme.default.requestedSubThemeIds).toEqual({
      light: "default.github",
      dark: "default.newspaper",
    });

    act(() => latest?.setInterfaceStyle("windows-xp"));
    expect(latest?.requestedSubThemeId).toBe("windows-xp.luna-blue");
    expect(latest?.themeMode).toBe("light");

    act(() => latest?.setInterfaceStyle("default"));
    expect(latest?.requestedSubThemeId).toBe("default.newspaper");
    expect(latest?.themeMode).toBe("dark");
    act(() => latest?.setThemeMode("light"));
    expect(latest?.requestedSubThemeId).toBe("default.github");
    expect(readStored().schemaVersion).toBe(6);
    expect(readStored().shared).not.toHaveProperty("textSize");
    expect(LEGACY_APPEARANCE_STORAGE_KEYS.every(
      (key) => window.localStorage.getItem(key) === null,
    )).toBe(true);
  });

  it("synchronizes the canonical appearance document across windows", () => {
    act(() => root.render(<Harness />));
    const remote: AppearancePreferencesV6 = {
      ...readStored(),
      activeRootThemeId: "windows-xp",
      byRootTheme: {
        ...readStored().byRootTheme,
        "windows-xp": {
          requestedColorMode: "light",
          requestedSubThemeIds: {
            light: "windows-xp.luna-blue",
            dark: "windows-xp.luna-blue",
          },
        },
      },
    };

    act(() => window.dispatchEvent(new StorageEvent("storage", {
      key: APPEARANCE_PREFERENCES_STORAGE_KEY,
      newValue: JSON.stringify(remote),
    })));

    expect(latest?.interfaceStyle).toBe("windows-xp");
    expect(latest?.requestedSubThemeId).toBe("windows-xp.luna-blue");
    expect(latest?.themeMode).toBe("light");
  });

  it("migrates the retired coordinated Theme Pack into the active root", () => {
    window.localStorage.setItem(LEGACY_SURFACE_THEME_PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 5,
      pack: "builtin.pack.newspaper",
    }));

    act(() => root.render(<Harness />));

    expect(latest?.requestedSubThemeId).toBe("default.newspaper");
    expect(readStored().byRootTheme.default.requestedSubThemeIds).toEqual({
      light: "default.newspaper",
      dark: "default.newspaper",
    });
  });

  it("migrates standalone typography once and removes every legacy Appearance key", () => {
    window.localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify({
      version: 3,
      contentFontId: BUILTIN_FONT_IDS.systemSerif,
      codeFontId: BUILTIN_FONT_IDS.geistMono,
      terminalFontId: BUILTIN_FONT_IDS.terminalSystemMono,
    }));

    act(() => root.render(<Harness />));

    expect(readStored().shared.typography.contentFont).toEqual({
      mode: "explicit",
      fontId: BUILTIN_FONT_IDS.systemSerif,
    });
    expect(LEGACY_APPEARANCE_STORAGE_KEYS.every(
      (key) => window.localStorage.getItem(key) === null,
    )).toBe(true);
  });

  it("prefers the canonical document over conflicting standalone legacy values", () => {
    window.localStorage.setItem(APPEARANCE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      schemaVersion: 4,
      activeRootThemeId: "default",
      shared: {
        textSize: "default",
        typography: {
          version: 3,
          contentFontId: BUILTIN_FONT_IDS.systemSans,
          codeFontId: BUILTIN_FONT_IDS.geistMono,
          terminalFontId: BUILTIN_FONT_IDS.terminalSystemMono,
        },
        pointerCursors: false,
        loadingAnimationPreset: "ikun",
        fileIconTheme: "default",
        sidebarNavigationLayout: "bottom-horizontal",
      },
      byRootTheme: {},
      bySurface: {},
    }));
    window.localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify({
      version: 3,
      contentFontId: BUILTIN_FONT_IDS.systemSerif,
    }));

    act(() => root.render(<Harness />));

    expect(readStored().schemaVersion).toBe(6);
    expect(readStored().shared.typography.contentFont).toEqual({
      mode: "explicit",
      fontId: BUILTIN_FONT_IDS.systemSans,
    });
    expect(window.localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)).toBeNull();
  });

  it("ignores retired-key events after migration", () => {
    act(() => root.render(<Harness />));
    const before = latest?.typographyPreferences;

    act(() => {
      window.localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify({
        version: 3,
        contentFontId: BUILTIN_FONT_IDS.systemSerif,
      }));
      window.dispatchEvent(new StorageEvent("storage", {
        key: TYPOGRAPHY_STORAGE_KEY,
        newValue: window.localStorage.getItem(TYPOGRAPHY_STORAGE_KEY),
      }));
    });

    expect(latest?.typographyPreferences).toEqual(before);
    expect(readStored().shared.typography).toEqual(before);
  });

  it("does not overwrite a future canonical schema or erase its migration inputs", () => {
    const future = JSON.stringify({ schemaVersion: 99, activeRootThemeId: "future" });
    window.localStorage.setItem(APPEARANCE_PREFERENCES_STORAGE_KEY, future);
    window.localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify({
      version: 3,
      contentFontId: BUILTIN_FONT_IDS.systemSerif,
    }));

    act(() => root.render(<Harness />));

    expect(window.localStorage.getItem(APPEARANCE_PREFERENCES_STORAGE_KEY)).toBe(future);
    expect(window.localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)).not.toBeNull();
  });

  it("preserves migration inputs when the canonical write fails", () => {
    window.localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify({
      version: 3,
      contentFontId: BUILTIN_FONT_IDS.systemSerif,
    }));
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(window.localStorage, "setItem").mockImplementation((key, value) => {
      if (key === APPEARANCE_PREFERENCES_STORAGE_KEY) throw new DOMException("Quota exceeded", "QuotaExceededError");
      originalSetItem(key, value);
    });

    act(() => root.render(<Harness />));

    expect(window.localStorage.getItem(APPEARANCE_PREFERENCES_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)).not.toBeNull();
    expect(latest?.typographyPreferences.contentFont).toEqual({
      mode: "explicit",
      fontId: BUILTIN_FONT_IDS.systemSerif,
    });
  });
});

function Harness() {
  latest = useDesktopPreferences();
  return null;
}

function readStored(): AppearancePreferencesV6 {
  return JSON.parse(
    window.localStorage.getItem(APPEARANCE_PREFERENCES_STORAGE_KEY) ?? "null",
  );
}
