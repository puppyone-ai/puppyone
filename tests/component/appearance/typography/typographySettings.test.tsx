/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TypographySettingsView } from "../../../../src/features/settings/main/TypographySettingsView";
import { TypographyScaleSetting } from "../../../../src/features/settings/TypographyScaleSetting";
import { DEFAULT_TYPOGRAPHY_PREFERENCES } from "../../../../src/features/typography";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Typography settings", () => {
  it("exposes one application-wide Small, Medium, and Large scale", () => {
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

    const scale = host.querySelector('[aria-label="Application text size"]');
    expect(scale).not.toBeNull();
    expect(scale?.querySelectorAll("button")).toHaveLength(3);
    expect(host.textContent).toContain("Adjust text size across PuppyOne.");
    expect(host.textContent).not.toContain("Entire application");
    expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
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

  it("previews the workspace around H1-H3, body, and bold without interactive controls", () => {
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
    const editor = preview?.querySelector<HTMLElement>('[aria-label="Editor"]');
    expect(editor?.dataset.poThemeSurface).toBe("markdown");
    expect(editor?.dataset.poThemeId).toBe("default-neutral");
    expect(editor?.dataset.poTypographyRole).toBe("content");
    expect(preview?.hasAttribute("data-po-theme-surface")).toBe(false);
    expect(preview?.querySelector('[aria-label="Left sidebar"]')?.textContent).toContain("Notes.md");
    expect(preview?.querySelector('[aria-label="Right sidebar"]')?.textContent).toContain("I can help you organize these notes.");
    expect(preview?.querySelectorAll("button, input, textarea, [tabindex], [contenteditable=true]")).toHaveLength(0);
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

  it("updates the single application scale without exposing custom values", () => {
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

    const largeButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Use Large text throughout PuppyOne"]',
    );
    act(() => largeButton?.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      scale: "large",
    }));
    expect(onChange.mock.calls[0]?.[0]).not.toHaveProperty("scales");
    expect(host.querySelector('input[type="number"]')).toBeNull();
  });
});
