/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readTerminalFontFamily,
  readTerminalFontSize,
  readTerminalTheme,
  readTerminalAppearance,
  applyTerminalAppearance,
  resolveTerminalAppearanceSource,
  terminalDefaultColorsFromTheme,
} from "../../../../src/features/desktop-terminal/runtime/terminalAppearance";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("terminal default-color negotiation", () => {
  it("uses product selection pairs and dims a retained terminal on window blur", () => {
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const owner = document.createElement("div");
    owner.style.setProperty("--po-text-selection-bg", "rgba(30, 120, 80, 0.3)");
    owner.style.setProperty("--po-text-selection-inactive-bg", "rgba(30, 120, 80, 0.15)");
    document.body.append(owner);
    const active = readTerminalTheme(owner);
    expect(active.selectionBackground).toBe("rgba(30, 120, 80, 0.3)");
    expect(active.selectionForeground).toBeUndefined();
    focused.mockReturnValue(false);
    expect(readTerminalTheme(owner).selectionBackground).toBe(active.selectionInactiveBackground);
    owner.style.setProperty("--po-terminal-selection-inactive", "rgba(140, 90, 200, 0.2)");
    expect(readTerminalTheme(owner).selectionBackground).toBe("rgba(140, 90, 200, 0.2)");
  });

  it("does not reassign terminal font metrics during a color-only refresh", () => {
    const owner = document.createElement("div"); document.body.append(owner);
    const appearance = readTerminalAppearance(owner);
    const options = { theme: appearance.theme };
    const fontFamily = vi.fn();
    const fontSize = vi.fn();
    Object.defineProperties(options, {
      fontFamily: { get: () => appearance.fontFamily, set: fontFamily },
      fontSize: { get: () => appearance.fontSize, set: fontSize },
    });
    applyTerminalAppearance({ options, rows: 24, refresh: vi.fn() } as never, appearance);
    expect(fontFamily).not.toHaveBeenCalled();
    expect(fontSize).not.toHaveBeenCalled();
  });
  it("captures the explicit owning surface before the runtime is detached", () => {
    const source = document.createElement("section");
    source.style.setProperty("--po-terminal-bg", "rgb(22, 20, 19)");
    source.style.setProperty("--po-terminal-fg", "rgb(209, 206, 198)");
    source.style.setProperty("--po-font-terminal", '"SF Mono", monospace');
    source.style.setProperty("--po-terminal-font-size", "14px");
    document.body.append(source);
    const detachedRuntimeHost = document.createElement("div");

    expect(() => resolveTerminalAppearanceSource(detachedRuntimeHost)).toThrow("connected owning surface");
    const appearance = readTerminalAppearance(source);
    expect(appearance.defaultColors).toEqual({
      foreground: [209, 206, 198],
      background: [22, 20, 19],
    });
    expect(readTerminalFontFamily(source)).toBe('"SF Mono", monospace');
    expect(readTerminalFontSize(source)).toBe(14);
    source.remove();
    const terminal = { options: {}, rows: 24, refresh: () => {} };
    expect(applyTerminalAppearance(terminal as never, appearance)).toEqual(appearance.defaultColors);
    expect(terminal.options).toEqual({ theme: appearance.theme, fontFamily: appearance.fontFamily, fontSize: 14 });
  });

  it("does not choose a different window or root when reading appearance", () => {
    const otherRoot = document.createElement("div");
    otherRoot.dataset.poAppearanceRoot = "true";
    otherRoot.style.setProperty("--po-terminal-bg", "rgb(250, 250, 250)");
    const owner = document.createElement("div");
    owner.style.setProperty("--po-terminal-bg", "rgb(235, 235, 235)");
    document.body.append(otherRoot, owner);
    expect(readTerminalAppearance(owner).defaultColors.background).toEqual([235, 235, 235]);
    expect(readTerminalTheme(otherRoot).background).toBe("rgb(250, 250, 250)");
  });

  it("converts Chromium CSS Color 4 serialization into OSC-ready RGB", () => {
    expect(terminalDefaultColorsFromTheme({
      foreground: "color(srgb 0.819608 0.807843 0.776471)",
      background: "color(srgb 0.0862745 0.0784314 0.0745098)",
    })).toEqual({
      foreground: [209, 206, 198],
      background: [22, 20, 19],
    });
  });

  it("supports modern rgb percentages without changing legacy RGB", () => {
    expect(terminalDefaultColorsFromTheme({
      foreground: "rgb(80% 75% 70%)",
      background: "rgb(23, 24, 28)",
    })).toEqual({
      foreground: [204, 191, 179],
      background: [23, 24, 28],
    });
  });

  it("uses safe defaults only for unsupported color serialization", () => {
    expect(terminalDefaultColorsFromTheme({
      foreground: "not-a-color",
      background: undefined,
    })).toEqual({
      foreground: [47, 42, 35],
      background: [251, 250, 247],
    });
  });
});
