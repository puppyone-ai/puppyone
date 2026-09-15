// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubThemeCatalogSnapshot } from "../../../../src/features/themes/builtinSubThemes";
import { SubThemeSettingsSection } from "../../../../src/features/settings/main/SubThemeSettingsSection";
import type { SubThemeCatalogController } from "../../../../src/features/themes/useSubThemeCatalog";
import { withTestLocalization } from "../../../support/react/localization";

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

describe("mode-first Sub Theme settings", () => {
  it("hides a light-only theme in Dark while preserving a safe effective selection", () => {
    const catalog = controller();
    render(catalog, "dark", "default.neutral");

    const darkOptions = [...container.querySelectorAll("option")].map((option) => option.value);
    expect(darkOptions).not.toContain("com.example.light-only");
    expect(container.querySelector<HTMLSelectElement>("select")?.value).toBe("default.neutral");
    expect(container.querySelector(".desktop-sub-theme-mode-badge")).toBeNull();

    render(catalog, "light", "com.example.light-only");
    const lightOptions = [...container.querySelectorAll("option")].map((option) => option.value);
    expect(lightOptions).toContain("com.example.light-only");
    expect(container.querySelector<HTMLSelectElement>("select")?.value).toBe("com.example.light-only");
    expect(container.querySelector(".desktop-sub-theme-mode-badge")).toBeNull();
  });
});

function render(
  catalog: SubThemeCatalogController,
  effectiveColorMode: "light" | "dark",
  effectiveSubThemeId: string,
) {
  act(() => root.render(withTestLocalization(
    <SubThemeSettingsSection
      catalog={catalog}
      rootThemeId="default"
      requestedSubThemeId="com.example.light-only"
      effectiveSubThemeId={effectiveSubThemeId}
      effectiveColorMode={effectiveColorMode}
      onSubThemeChange={vi.fn()}
    />,
  )));
}

function controller(): SubThemeCatalogController {
  return {
    snapshot: createSubThemeCatalogSnapshot({
      themes: [{
        id: "com.example.light-only",
        name: "Light Only",
        version: "1.0.0",
        contractVersion: 1,
        compatibleRootThemeIds: ["default"],
        modes: ["light"],
        targets: ["application", "markdown", "csv"],
        source: "local-package",
        compiledCss: {},
      }],
      diagnostics: [],
    }),
    status: "ready",
    error: null,
    openDirectory: vi.fn(async () => ({ opened: true })),
    createTheme: vi.fn(async () => ({ created: true, themeId: "local.user.custom-theme" })),
  };
}
