// @vitest-environment happy-dom

import { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SubThemeStyleHost } from "../src/features/themes/SubThemeStyleHost";
import {
  BUILTIN_SUB_THEMES,
  createSubThemeCatalogSnapshot,
} from "../src/features/themes/builtinSubThemes";
import {
  getSubThemeModes,
  getSubThemeVariant,
  type SubThemeDefinition,
} from "../src/features/themes/themeTypes";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../src/features/markdown/markdownPresentation";
import type { DesktopThemeDefinition } from "../src/types/electron";

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
  document.head.querySelectorAll("[data-po-sub-theme-style]").forEach((element) => element.remove());
});

describe("renderer Sub Theme style host", () => {
  it("registers built-ins as root-compatible visual variants", () => {
    expect(BUILTIN_SUB_THEMES.map((subTheme) => ({
      id: subTheme.id,
      compatibleRootThemeIds: subTheme.compatibleRootThemeIds,
      modes: getSubThemeModes(subTheme),
      targets: subTheme.targets,
    }))).toEqual([
      variant("default.neutral"),
      variant("default.warm"),
      variant("default.graphite"),
      variant("default.github"),
      variant("default.newspaper"),
      variant("windows-xp.luna-blue", ["windows-xp"], ["light"], ["markdown", "csv"]),
    ]);
  });

  it("authors built-ins as self-describing public-token packages and compiles the host boundary", () => {
    for (const relativePath of [
      "sub-themes/default-neutral/theme.css",
      "sub-themes/default-warm/theme.css",
      "sub-themes/default-graphite/theme.css",
      "sub-themes/default-github/theme.css",
      "sub-themes/default-newspaper/theme.css",
      "sub-themes/windows-xp-luna-blue/theme.css",
    ]) {
      const css = readFileSync(`${process.cwd()}/${relativePath}`, "utf8");
      expect(css).toContain("@puppyone-theme");
      expect(css).not.toMatch(/--po-host-(?:md|csv)-/);
      expect(css).not.toMatch(/\.cm-|\.markdown-codemirror-editor|\.csv-table-editor/);
    }
    const github = BUILTIN_SUB_THEMES.find(({ id }) => id === "default.github");
    const githubLight = github ? getSubThemeVariant(github, "light") : null;
    expect(githubLight?.compiledCss.application).toContain(
      '[data-po-appearance-root][data-sub-theme-id="default.github"]',
    );
    expect(githubLight?.compiledCss.markdown).toContain("--po-host-md-content-color");
    expect(githubLight?.compiledCss.csv).toContain("--po-host-csv-surface-background");
  });

  it("injects selected CSS inside the sub-theme cascade layer", () => {
    const selected = externalSubTheme({
      variants: {
        light: { compiledCss: {
          application: '[data-po-appearance-root][data-sub-theme-id="com.example.reader"] { --po-text: #222; }',
          markdown: '[data-po-appearance-root][data-sub-theme-id="com.example.reader"] { --po-host-md-content-color: #222; }',
        } },
      },
    });

    act(() => root.render(
      <SubThemeStyleHost
        subTheme={selected}
        colorMode="light"
        markdownPresentation={DEFAULT_MARKDOWN_PRESENTATION_SETTINGS}
      />,
    ));

    const styles = [...document.head.querySelectorAll<HTMLStyleElement>(
      "style[data-po-sub-theme-style]",
    )];
    expect(styles).toHaveLength(2);
    expect(styles.map((style) => style.dataset.poSubThemeTarget)).toEqual([
      "application",
      "markdown",
    ]);
    expect(styles.every((style) => style.dataset.poThemeLayer === "sub-theme")).toBe(true);
    expect(styles[0]?.textContent).toContain("@layer sub-theme");
    expect(styles[0]?.textContent).toContain("--po-text: #222");
  });

  it("removes stale CSS when the resolved Sub Theme changes", () => {
    const first = externalSubTheme({ id: "com.example.first" });
    const second = externalSubTheme({ id: "com.example.second" });
    act(() => root.render(
      <SubThemeStyleHost subTheme={first} colorMode="light" markdownPresentation={DEFAULT_MARKDOWN_PRESENTATION_SETTINGS} />,
    ));
    act(() => root.render(
      <SubThemeStyleHost subTheme={second} colorMode="light" markdownPresentation={DEFAULT_MARKDOWN_PRESENTATION_SETTINGS} />,
    ));

    expect(document.head.querySelector('[data-po-sub-theme-id="com.example.first"]')).toBeNull();
    expect(document.head.querySelector('[data-po-sub-theme-id="com.example.second"]')).not.toBeNull();
  });

  it("injects only the compiled variant selected by the effective Color Mode", () => {
    const selected = externalSubTheme();
    act(() => root.render(
      <SubThemeStyleHost subTheme={selected} colorMode="light" markdownPresentation={DEFAULT_MARKDOWN_PRESENTATION_SETTINGS} />,
    ));
    expect(document.head.querySelector('[data-po-sub-theme-mode="light"]')?.textContent)
      .toContain("#222");

    act(() => root.render(
      <SubThemeStyleHost subTheme={selected} colorMode="dark" markdownPresentation={DEFAULT_MARKDOWN_PRESENTATION_SETTINGS} />,
    ));
    expect(document.head.querySelector('[data-po-sub-theme-mode="light"]')).toBeNull();
    expect(document.head.querySelector('[data-po-sub-theme-mode="dark"]')?.textContent)
      .toContain("#ddd");
  });

  it("keeps retired managed Custom CSS out of the catalog", () => {
    const snapshot = createSubThemeCatalogSnapshot({
      themes: [externalDesktopTheme({ id: "local.puppyone.custom-css" })],
      diagnostics: [],
    });

    expect(snapshot.subThemes.some(({ id }) => id === "local.puppyone.custom-css")).toBe(false);
  });

  it("preserves declared future Root Theme compatibility without relabeling it as Default", () => {
    const installed = externalDesktopTheme({
      compatibleRootThemeIds: ["future-shell"],
    });
    const snapshot = createSubThemeCatalogSnapshot({ themes: [installed], diagnostics: [] });

    expect(snapshot.subThemes.find(({ id }) => id === installed.id)?.compatibleRootThemeIds)
      .toEqual(["future-shell"]);
  });

  it("puts typed surface preferences after Sub Theme CSS", () => {
    const selected = externalSubTheme();
    act(() => root.render(
      <SubThemeStyleHost
        subTheme={selected}
        colorMode="light"
        markdownPresentation={{
          ...DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
          headingScale: "large",
        }}
      />,
    ));

    const styles = [...document.head.querySelectorAll<HTMLStyleElement>(
      "style[data-po-sub-theme-style]",
    )];
    expect(styles.map((style) => style.dataset.poThemeLayer)).toEqual([
      "sub-theme",
      "appearance-overrides",
    ]);
    expect(styles[1]?.textContent).toContain("@layer appearance-overrides");
    expect(styles[1]?.textContent).toContain("--po-user-md-h1-size: 34px");
    expect(styles[1]?.textContent).toContain("[data-po-appearance-root][data-sub-theme-id]");
  });
});

function externalSubTheme(overrides: Partial<SubThemeDefinition> = {}): SubThemeDefinition {
  const id = overrides.id ?? "com.example.reader";
  return {
    id,
    family: "com.example",
    name: "Reader",
    version: "1.0.0",
    contractVersion: 1,
    compatibleRootThemeIds: ["default"],
    targets: ["application", "markdown", "csv"],
    source: "local-package",
    variants: {
      light: { compiledCss: {
        markdown: `[data-po-appearance-root][data-sub-theme-id="${id}"] { --po-host-md-content-color: #222; }`,
      } },
      dark: { compiledCss: {
        markdown: `[data-po-appearance-root][data-sub-theme-id="${id}"] { --po-host-md-content-color: #ddd; }`,
      } },
    },
    ...overrides,
  };
}

function externalDesktopTheme(
  overrides: Partial<DesktopThemeDefinition> = {},
): DesktopThemeDefinition {
  const id = overrides.id ?? "com.example.reader";
  return {
    id,
    name: "Reader",
    version: "1.0.0",
    contractVersion: 1,
    compatibleRootThemeIds: ["default"],
    modes: ["light", "dark"],
    targets: ["application", "markdown", "csv"],
    source: "local-package",
    compiledCss: {
      markdown: `[data-po-appearance-root][data-sub-theme-id="${id}"] { --po-host-md-content-color: #222; }`,
    },
    ...overrides,
  };
}

function variant(
  id: string,
  compatibleRootThemeIds: readonly ("default" | "windows-xp")[] = ["default"],
  modes: readonly ("light" | "dark")[] = ["light", "dark"],
  targets: readonly ("application" | "markdown" | "csv")[] = ["application", "markdown", "csv"],
) {
  return { id, compatibleRootThemeIds, modes, targets };
}
