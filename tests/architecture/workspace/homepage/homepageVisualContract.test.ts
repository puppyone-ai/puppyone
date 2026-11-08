import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Homepage's visual contract: the few appearance rules a behaviour test cannot
 * see, kept in this one file. Behaviour and layout belong to the component and
 * Electron scenarios; this file only guards what the design decided must never
 * appear on the page, so a styling refactor changes one place, not many.
 */
const css = readFileSync("src/styles/onboarding.css", "utf8");
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing rule ${selector}`);
  return css.slice(start, css.indexOf("}", start) + 1);
};

describe("Homepage visual contract", () => {
  it("draws every folder in the theme's ink alone: no colour, outline, gradient or shadow", () => {
    for (const selector of [".project-folder-back", ".project-folder-front", ".onboarding-project-folder"]) {
      expect(rule(selector)).not.toMatch(/brand-blue|--po-accent|#[0-9a-f]{3,8}\b|gradient|shadow|stroke|url\(/i);
    }
  });

  it("keeps colour out of the groups: their labels, rules and drop targets are ink", () => {
    const groups = css.slice(css.indexOf(".onboarding-project-groups {"));
    expect(groups).not.toMatch(/brand-blue|--po-accent|--po-success|#[0-9a-f]{3,8}\b/i);
  });

  it("lets the sheet arrive without motion for those who ask for less", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.project-folder-sheet \{\s*transition: none;/);
  });

  it("sets group labels and New in the product's own type tokens, never a hardcoded size", () => {
    expect(rule(".onboarding-project-group-head")).toMatch(/font-size: var\(--onboarding-caption-font-size\)/);
    expect(css).toMatch(/:is\(\.onboarding-entry-action, \.onboarding-entry-menu-trigger\) \{[^}]*font-size: var\(--po-type-ui-meta/);
  });
});
