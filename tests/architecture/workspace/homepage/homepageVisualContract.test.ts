import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Homepage's visual contract: the few appearance rules a behaviour test cannot
 * see, kept in this one file. Behaviour and layout belong to the component and
 * Electron scenarios; this file only guards what the design decided must never
 * appear on the page, so a styling refactor changes one place, not many.
 */
const css = readFileSync("src/styles/onboarding.css", "utf8");
const onboardingCss = css;
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

  describe("page", () => {
    it("sets the projects on the page itself, with a fill only for a folder dragged over it", () => {
      expect(onboardingCss).not.toMatch(/\.onboarding-home-primary[^{]*\{[^}]*border-(?:block|top|bottom)\s*:/s);
      const surface = onboardingCss.match(/\.onboarding-home-primary\[data-onboarding-primary="projects"\]\s*\{[^}]*\}/s)?.[0] ?? "";
      expect(surface).not.toMatch(/background/);
      expect(onboardingCss).toMatch(/\.onboarding-shell\.dragging \.onboarding-home-primary\[data-onboarding-primary="projects"\]\s*\{\s*background:\s*var\(--po-hover\);/);
    });

    it("takes its buttons from the shared Button and its values from the theme", () => {
      const action = onboardingCss.match(/\.onboarding-entry-action\s*\{[^}]*\}/s)?.[0] ?? "";
      expect(action).not.toMatch(/(?:^|\s)(?:height|padding|border|border-radius|background|color):/m);
      expect(action).toMatch(/font-size:\s*var\(--onboarding-row-font-size\);\s*font-weight:\s*var\(--onboarding-row-font-weight\);/);
      expect(onboardingCss).not.toMatch(/border-radius:\s*(?:7|10|12|14|16|26)px/);
      expect(onboardingCss).not.toMatch(/font-weight:\s*\d/);
      expect(onboardingCss).not.toMatch(/letter-spacing:\s*-/);
      expect(onboardingCss).toMatch(/--onboarding-row-font-weight:\s*var\(--po-text-weight-regular, 400\);/);
    });

    it("sets every size in the product's type tokens: the first-run title, the body, the caption and a button's meta", () => {
      const page = onboardingCss.slice(0, onboardingCss.indexOf(".project-cloud-link-button {"));
      const sizes = new Set([...page.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1]!.trim()));
      const allowed = new Set([
        "var(--desktop-titlebar-context-font-size)",
        "var(--onboarding-caption-font-size)",
        "var(--onboarding-row-font-size)",
        "var(--po-text-size-caption, 11px)",
        "var(--po-type-ui-body, 14px)",
        "var(--po-type-ui-caption, 12px)",
        "var(--po-type-ui-heading, 19px)",
        "var(--po-type-ui-meta, 13px)",
      ]);
      expect([...sizes].filter((size) => !allowed.has(size))).toEqual([]);
      expect(onboardingCss).toMatch(/--onboarding-row-font-size:\s*var\(--po-type-ui-body, 14px\);/);
      expect(onboardingCss).toMatch(/--onboarding-caption-font-size:\s*var\(--po-type-ui-caption, 12px\);/);
    });

    it("lets the project scrollport use remaining height without fixed list caps", () => {
      expect(onboardingCss).toContain("grid-template-rows: auto minmax(0, 1fr) auto;");
      expect(onboardingCss).toMatch(/\.onboarding-project-list\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;[^}]*scrollbar-gutter:\s*stable;/s);
      expect(onboardingCss).not.toMatch(/\.onboarding-project-list\s*\{[^}]*max-height:/s);
      expect(onboardingCss).not.toMatch(/\.onboarding-home-primary\[data-onboarding-primary="projects"\]\s*\{[^}]*max-height:/s);
      expect(onboardingCss).not.toContain("::-webkit-scrollbar");
    });

    it("preserves the upper rhythm and reclaims space only below the project list", () => {
      // The projects page hangs from the shared Header; the list runs to the window's edge,
      // so what is below shows there, and only the list absorbs extra height.
      expect(onboardingCss).toMatch(
        /\.onboarding-homepage-shell\[data-onboarding-state="projects"\]\s*\{[^}]*padding-block-start:\s*calc\(var\(--desktop-chrome-height\) \+ var\(--onboarding-title-inset\)\);[^}]*padding-block-end:\s*0;/s,
      );
      expect(onboardingCss).toMatch(/\.onboarding-shell\[data-onboarding-state="projects"\] \.onboarding-homepage\s*\{[^}]*--onboarding-title-primary-gap:\s*8px;[^}]*--onboarding-primary-actions-gap:\s*0;/s);
    });

    it("tones the canonical Puppy mark down only on dark onboarding surfaces", () => {
      expect(onboardingCss).toMatch(
        /\.onboarding-shell\.dark \.onboarding-brand-mark-artwork\s*\{[^}]*filter:\s*grayscale\(1\) brightness\(0\.7\);/s,
      );
      expect(onboardingCss).not.toMatch(
        /(?:^|\n)\.onboarding-brand-mark-artwork\s*\{[^}]*filter:/s,
      );
    });

    it("uses one page skeleton and one framed primary section for both home states", () => {
      expect(onboardingCss).toMatch(
        /\.onboarding-launcher\s*\{[^}]*display:\s*grid;[^}]*width:\s*var\(--onboarding-column-width\);[^}]*gap:\s*0;/s,
      );
      expect(onboardingCss).not.toMatch(
        /\.onboarding-shell\[data-onboarding-state="empty"\] \.onboarding-launcher/,
      );
      expect(onboardingCss).toMatch(
        /\.onboarding-home-primary\s*\{[^}]*padding:\s*0;[^}]*margin-block-end:\s*var\(--onboarding-primary-actions-gap\);[^}]*border:\s*0;/s,
      );
      expect(onboardingCss).not.toMatch(
        /\.onboarding-home-primary\[data-onboarding-primary="create"\]/,
      );
      expect(onboardingCss).toMatch(
        /\.onboarding-homepage\s*\{[^}]*--onboarding-title-primary-gap:\s*58px;[^}]*--onboarding-primary-actions-gap:\s*30px;/s,
      );
      expect(onboardingCss).toMatch(
        /\.onboarding-shell\[data-onboarding-state="empty"\] \.onboarding-homepage\s*\{[^}]*--onboarding-title-primary-gap:\s*20px;[^}]*--onboarding-primary-actions-gap:\s*8px;/s,
      );
      expect(onboardingCss).toMatch(
        /\.onboarding-brand-lockup\s*\{[^}]*margin-block-end:\s*var\(--onboarding-title-primary-gap\);/s,
      );
      expect(onboardingCss).not.toContain(".onboarding-entry-action-divider");
      expect(onboardingCss).not.toContain(".onboarding-entry-action-primary");
      expect(onboardingCss).not.toContain(".onboarding-entry-action-secondary");
      expect(onboardingCss).not.toContain(".onboarding-recent-projects");
      expect(onboardingCss).not.toContain(".onboarding-projects-layout");
      expect(onboardingCss).not.toMatch(/\.onboarding-entry-import\s*\{[^}]*height:/s);
      expect(onboardingCss).not.toMatch(/\.onboarding-entry-import:hover/);
    });

    it("names the product in the Header in the muted ink of a project's Header", () => {
      expect(onboardingCss).toMatch(/\.onboarding-header-brand \{\s*color: var\(--desktop-titlebar-text-muted\);/);
      expect(onboardingCss).toMatch(/\.homepage-cloud-avatar \{[^}]*color: var\(--desktop-titlebar-text-muted\);/s);
      expect(onboardingCss).not.toContain("onboarding-header-mark");
    });

    it("brightens the project actions on their own, with a ring for the keyboard", () => {
      const hover = onboardingCss.match(/\.desktop-menu-icon-button\.onboarding-project-actions:hover:not\(:disabled\),[^{]*\{[^}]*\}/)?.[0];
      expect(hover).toMatch(/background:\s*transparent;/);
      expect(hover).toMatch(/color:\s*var\(--po-text\);/);
      expect(onboardingCss).toMatch(/\.onboarding-project-actions:focus-visible:not\(:disabled\)\s*\{\s*outline:\s*2px solid var\(--po-focus-ring\)/);
    });

    it("lifts the first-run New in the accent's own hover", () => {
      expect(onboardingCss).toMatch(
        /\.onboarding-entry-action-default:hover:not\(:disabled\)\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--po-accent\) 88%, var\(--po-canvas\)\);/s,
      );
    });
  });
});
