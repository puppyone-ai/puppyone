/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TypographySettingsView } from "../src/features/settings/main/TypographySettingsView";
import { TypographyScaleSetting } from "../src/features/settings/TypographyScaleSetting";
import { DEFAULT_TYPOGRAPHY_PREFERENCES } from "../src/features/typography";
import { withTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Typography settings", () => {
  it("exposes independent Left sidebar, Header, Editor, and Right sidebar scales", () => {
    const host = document.createElement("div");
    host.dataset.poAppearanceRoot = "true";
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <TypographySettingsView
        typographyPreferences={DEFAULT_TYPOGRAPHY_PREFERENCES}
        markdownThemeId="default-neutral"
        onTypographyPreferencesChange={vi.fn()}
      />,
    )));

    expect(host.querySelector('[aria-label="Left sidebar text size"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Header text size"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Editor text size"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Right sidebar text size"]')).not.toBeNull();
    expect(host.querySelectorAll('[aria-label="Left sidebar text size"] button')).toHaveLength(3);
    expect(host.querySelectorAll('[aria-label="Header text size"] button')).toHaveLength(3);
    expect(host.querySelectorAll('[aria-label="Editor text size"] button')).toHaveLength(3);
    expect(host.querySelectorAll('[aria-label="Right sidebar text size"] button')).toHaveLength(3);
    expect(host.textContent).not.toContain("px");
    expect(host.textContent).not.toContain("Follow theme");
    expect(host.querySelector('[aria-label="Heading size"]')).toBeNull();
    expect(host.querySelector('[aria-label="Bold color"]')).toBeNull();
    expect(host.querySelector('[aria-label="Bold weight"]')).toBeNull();
    expect(host.querySelector('[aria-label="Markdown style preview"]')).toBeNull();
    expect(host.querySelector("[data-active-markdown-theme]")).toBeNull();
    expect(host.querySelector("[data-manage-themes]")).toBeNull();
    expect(host.querySelector("[data-reset-markdown-overrides]")).toBeNull();
  });

  it("previews H1-H3, body, and bold typography with standard labels", () => {
    const host = document.createElement("div");
    host.dataset.poAppearanceRoot = "true";
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <TypographySettingsView
        typographyPreferences={DEFAULT_TYPOGRAPHY_PREFERENCES}
        markdownThemeId="default-neutral"
        onTypographyPreferencesChange={vi.fn()}
      />,
    )));

    const preview = host.querySelector<HTMLElement>('[aria-label="Typography preview"]');
    expect(preview).not.toBeNull();
    expect(preview?.dataset.poThemeSurface).toBe("markdown");
    expect(preview?.dataset.poThemeId).toBe("default-neutral");
    expect(preview?.dataset.poTypographyRole).toBe("content");
    expect(preview?.querySelector('[role="document"]')?.getAttribute("lang")).toBe("en");
    expect(preview?.querySelector("h1")?.textContent).toBe("H1 Title");
    expect(preview?.querySelector("h2")?.textContent).toBe("H2 Title");
    expect(preview?.querySelector("h3")?.textContent).toBe("H3 Title");
    const body = preview?.querySelector(".desktop-typography-preview-body");
    expect(body?.textContent).toBe(
      "Body text demonstrates how clear typography creates a comfortable reading experience.",
    );
    expect(body?.querySelector("strong")?.textContent).toBe("comfortable reading experience");
  });

  it("updates a surface scale without exposing individual typography roles", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    host.dataset.poAppearanceRoot = "true";
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <TypographyScaleSetting
        preferences={DEFAULT_TYPOGRAPHY_PREFERENCES}
        onChange={onChange}
      />,
    )));

    const rightSidebarButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Use Large text for Right sidebar"]',
    );
    act(() => rightSidebarButton?.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      scales: expect.objectContaining({
        rightSidebar: "large",
      }),
    }));
  });

  it("updates the sidebar and header scales independently", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    host.dataset.poAppearanceRoot = "true";
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <TypographyScaleSetting
        preferences={DEFAULT_TYPOGRAPHY_PREFERENCES}
        onChange={onChange}
      />,
    )));

    const leftSidebarButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Use Large text for Left sidebar"]',
    );
    act(() => leftSidebarButton?.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      scales: expect.objectContaining({
        leftSidebar: "large",
        header: "medium",
        editor: "medium",
        rightSidebar: "medium",
      }),
    }));

    const headerButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Use Small text for Header"]',
    );
    act(() => headerButton?.click());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      scales: expect.objectContaining({
        leftSidebar: "medium",
        header: "small",
        editor: "medium",
        rightSidebar: "medium",
      }),
    }));

  });
});
