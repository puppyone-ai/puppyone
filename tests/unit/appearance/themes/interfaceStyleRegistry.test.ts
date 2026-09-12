import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTERFACE_STYLE,
  INTERFACE_STYLES,
  getInterfaceStyleDefinition,
  getInterfaceStyleFirstPaint,
  getInterfaceStyleThemeModes,
  parseInterfaceStyle,
  resolveActiveThemeMode,
  supportsThemePreset,
} from "../../../../src/features/appearance/interfaceStyles";

describe("Interface style registry", () => {
  it("owns every style id and safely parses persisted values", () => {
    expect(DEFAULT_INTERFACE_STYLE).toBe("default");
    expect(new Set(INTERFACE_STYLES.map((style) => style.id)).size).toBe(INTERFACE_STYLES.length);
    for (const style of INTERFACE_STYLES) expect(parseInterfaceStyle(style.id)).toBe(style.id);
    expect(parseInterfaceStyle("windows-7")).toBe(DEFAULT_INTERFACE_STYLE);
    expect(parseInterfaceStyle(null)).toBe(DEFAULT_INTERFACE_STYLE);
  });

  it("derives color controls and active modes from palette capabilities", () => {
    expect(getInterfaceStyleThemeModes("default")).toEqual(["system", "light", "dark"]);
    expect(supportsThemePreset("default", "light")).toBe(true);
    expect(supportsThemePreset("default", "dark")).toBe(true);
    expect(resolveActiveThemeMode("default", "system")).toBe("system");
    expect(resolveActiveThemeMode("default", "dark")).toBe("dark");

    for (const style of INTERFACE_STYLES) {
      if (style.palette.kind !== "fixed") continue;
      expect(getInterfaceStyleThemeModes(style.id)).toEqual([]);
      expect(supportsThemePreset(style.id, "light")).toBe(false);
      expect(supportsThemePreset(style.id, "dark")).toBe(false);
      expect(resolveActiveThemeMode(style.id, "system")).toBe(style.palette.mode);
      expect(resolveActiveThemeMode(style.id, "dark")).toBe(style.palette.mode);
    }
  });

  it("keeps every registry lookup total", () => {
    for (const style of INTERFACE_STYLES) {
      expect(getInterfaceStyleDefinition(style.id).id).toBe(style.id);
      const resolved = resolveActiveThemeMode(style.id, "system");
      const theme = resolved === "system" ? "light" : resolved;
      expect(getInterfaceStyleFirstPaint(style.id, theme).background).toMatch(/^#/);
    }
  });
});
