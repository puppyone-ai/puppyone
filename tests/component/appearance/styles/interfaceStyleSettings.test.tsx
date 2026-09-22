/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { INTERFACE_STYLES, type InterfaceStyle } from "../../../../src/features/appearance/interfaceStyles";
import { resolveAppearance } from "../../../../src/features/appearance/resolveAppearance";
import { InterfacePaletteSettings } from "../../../../src/features/settings/main/InterfacePaletteSettings";
import { InterfaceStyleSetting } from "../../../../src/features/settings/main/InterfaceStyleSetting";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Interface style settings", () => {
  it("renders style choices from the registry and emits their typed id", () => {
    const onChange = vi.fn();
    const host = mount(
      <InterfaceStyleSetting value="default" onChange={onChange} />,
    );
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];

    expect(buttons).toHaveLength(INTERFACE_STYLES.length);
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Default",
      "Windows XP",
    ]);
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");

    act(() => buttons[1]?.click());
    expect(onChange).toHaveBeenCalledWith("windows-xp");
  });

  it("shows only the color mode control for an adaptive palette", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    renderPalette(host, "default");
    expect(host.querySelectorAll(".desktop-theme-choice")).toHaveLength(3);
    expect(host.textContent).not.toContain("Light theme");
    expect(host.textContent).not.toContain("Dark theme");
    expect(host.querySelector(".desktop-theme-preset-list")).toBeNull();

    for (const style of INTERFACE_STYLES.filter(({ palette }) => palette.kind === "fixed")) {
      renderPalette(host, style.id);
      expect(host.querySelector(".desktop-theme-choice")).toBeNull();
      expect(host.querySelector(".desktop-theme-preset-list")).toBeNull();
      expect(host.textContent).toBe("");
    }
  });
});

function mount(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(withTestLocalization(element)));
  return host;
}

function renderPalette(host: HTMLElement, interfaceStyle: InterfaceStyle) {
  const decision = resolveAppearance({
    interfaceStyle,
    themeMode: "system",
    sidebarNavigationLayout: "bottom-horizontal",
    fileIconTheme: "semantic",
  }).decisions.themeMode;
  act(() => root?.render(withTestLocalization(
    <InterfacePaletteSettings
      interfaceStyle={interfaceStyle}
      subThemeId="default.neutral"
      decision={decision}
      lightThemePreset="neutral"
      darkThemePreset="default"
      onThemeModeChange={() => undefined}
    />,
  )));
  return host;
}
