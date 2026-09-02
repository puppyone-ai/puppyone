// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubThemeSettingsSection } from "../src/features/settings/main/SubThemeSettingsSection";
import { createSubThemeCatalogSnapshot } from "../src/features/themes/builtinSubThemes";
import type { SubThemeCatalogController } from "../src/features/themes/useSubThemeCatalog";
import { withTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Appearance theme settings", () => {
  it("keeps the hugging pack selector and icon actions in one compact module", async () => {
    await act(async () => {
      root.render(withTestLocalization(
        <SubThemeSettingsSection
          catalog={controller({})}
          rootThemeId="default"
          requestedSubThemeId="default.neutral"
          effectiveSubThemeId="default.neutral"
          effectiveColorMode="light"
          onSubThemeChange={vi.fn()}
        />,
      ));
      await Promise.resolve();
    });

    const controls = document.querySelector(".desktop-theme-pack-controls");
    expect(controls?.querySelector("select")).not.toBeNull();
    expect([...controls?.querySelectorAll("button") ?? []].map((button) => button.getAttribute("aria-label")))
      .toEqual(["Open Themes Folder", "Add Theme"]);
    expect([...controls?.querySelectorAll("button") ?? []].every((button) => button.textContent === ""))
      .toBe(true);
    expect(document.querySelector(".desktop-theme-settings-action-row")).toBeNull();
    expect(document.body.textContent).not.toContain(
      "Choose one coordinated theme pack for the application, Markdown, and CSV.",
    );
    expect(document.body.textContent).not.toContain("Reload Themes");
    expect(document.body.textContent).not.toContain("Advanced: Custom CSS");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("creates and selects a local one-file theme from Add Theme", async () => {
    const createTheme = vi.fn(async () => ({
      created: true,
      themeId: "local.user.custom-theme",
    }));
    const onSubThemeChange = vi.fn();
    await act(async () => {
      root.render(withTestLocalization(
        <SubThemeSettingsSection
          catalog={controller({ createTheme })}
          rootThemeId="default"
          requestedSubThemeId="default.neutral"
          effectiveSubThemeId="default.neutral"
          effectiveColorMode="light"
          onSubThemeChange={onSubThemeChange}
        />,
      ));
      await Promise.resolve();
    });

    const addTheme = document.querySelector<HTMLButtonElement>('button[aria-label="Add Theme"]');
    expect(addTheme?.disabled).toBe(false);
    await act(async () => {
      addTheme?.click();
      await Promise.resolve();
    });
    expect(createTheme).toHaveBeenCalledOnce();
    expect(onSubThemeChange).toHaveBeenCalledWith("local.user.custom-theme");
    expect(document.getElementById("desktop-theme-add-status")).toBeNull();
  });

  it("makes an active Markdown font override visible and lets the user restore theme control", async () => {
    const onUseThemeMarkdownFont = vi.fn();
    await act(async () => {
      root.render(withTestLocalization(
        <SubThemeSettingsSection
          catalog={controller({})}
          rootThemeId="default"
          requestedSubThemeId="default.newspaper"
          effectiveSubThemeId="default.newspaper"
          effectiveColorMode="light"
          markdownFontOverrideActive
          onSubThemeChange={vi.fn()}
          onUseThemeMarkdownFont={onUseThemeMarkdownFont}
        />,
      ));
      await Promise.resolve();
    });

    const notice = document.querySelector<HTMLElement>(".desktop-theme-font-override");
    expect(notice?.textContent).toContain("Markdown font is overridden in Editor settings.");
    const restore = notice?.querySelector<HTMLButtonElement>("button");
    expect(restore?.textContent).toBe("Use theme font");

    act(() => restore?.click());
    expect(onUseThemeMarkdownFont).toHaveBeenCalledOnce();
  });
});

function controller(overrides: Partial<SubThemeCatalogController>): SubThemeCatalogController {
  return {
    snapshot: createSubThemeCatalogSnapshot({ themes: [], diagnostics: [] }),
    status: "ready",
    error: null,
    openDirectory: vi.fn(async () => ({ opened: true })),
    createTheme: vi.fn(async () => ({ created: true, themeId: "local.user.custom-theme" })),
    ...overrides,
  };
}
