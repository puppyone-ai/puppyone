/**
 * @vitest-environment happy-dom
 */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownFontSetting } from "../src/features/settings/MarkdownFontSetting";
import {
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  TypographyCatalogProvider,
  type FontCatalogEntry,
} from "../src/features/typography";
import { renderWithTestLocalization, stripBidiIsolation } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("MarkdownFontSetting", () => {
  it("defaults to Follow theme and can select an explicit content font", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    function ControlledSetting() {
      const [preferences, setPreferences] = useState(DEFAULT_TYPOGRAPHY_PREFERENCES);
      return <MarkdownFontSetting preferences={preferences} onChange={setPreferences} />;
    }

    act(() => renderWithTestLocalization(root,
      <TypographyCatalogProvider>
        <ControlledSetting />
      </TypographyCatalogProvider>,
    ));

    const themeButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => (
        stripBidiIsolation(candidate.getAttribute("aria-label"))
        === "Follow the active theme font for Markdown text"
      ));
    expect(themeButton?.getAttribute("aria-pressed")).toBe("true");
    expect(DEFAULT_TYPOGRAPHY_PREFERENCES.contentFont).toEqual({ mode: "follow-theme" });

    const serifButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((candidate) => (
        stripBidiIsolation(candidate.getAttribute("aria-label")) === "Use Serif for Markdown text"
      ));
    expect(serifButton).not.toBeNull();

    act(() => serifButton?.click());
    expect(serifButton?.getAttribute("aria-pressed")).toBe("true");
    expect(themeButton?.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders future imported catalog entries without changing its preference contract", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChange = vi.fn();

    act(() => renderWithTestLocalization(root,
      <TypographyCatalogProvider additionalEntries={[importedFont]}>
        <MarkdownFontSetting
          preferences={DEFAULT_TYPOGRAPHY_PREFERENCES}
          onChange={onChange}
        />
      </TypographyCatalogProvider>,
    ));

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Follow theme",
      "Geist",
      "System",
      "Serif",
      "Imported",
    ]);

    act(() => buttons.at(-1)?.click());
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_TYPOGRAPHY_PREFERENCES,
      contentFont: { mode: "explicit", fontId: importedFont.id },
    });
  });
});

const importedFont: FontCatalogEntry = {
  id: "imported:fixture-font",
  label: "Imported",
  description: "Imported fixture font",
  family: '"PuppyOne Imported Fixture"',
  category: "serif",
  source: "imported",
  roles: ["content"],
};
