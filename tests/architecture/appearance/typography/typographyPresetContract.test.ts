import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("appearance preferences", () => {
  it("keeps the CSS typography token sets aligned with the preset contract", () => {
    const css = readFileSync(
      new URL("../../../../src/styles/typography/foundations.css", import.meta.url),
      "utf8",
    );
    const tokens = readFileSync(new URL("../../../../src/styles/tokens.css", import.meta.url), "utf8");
    expect(css).toContain("--po-type-editor-content:");
    expect(css).toContain("--po-user-text-size-content");
    expect(css).toContain("--po-type-editor-line-height:");
    expect(css).not.toContain('[data-content-text-size="small"]');
    expect(css).not.toContain('[data-content-text-size="large"]');

    expect(css).not.toContain("data-interface-text-size");
    expect(css).not.toContain("data-terminal-text-size");
    expect(css).not.toContain("data-text-size");

    expect(tokens).toMatch(
      /:root,\s*:where\(\.app-shell, \.onboarding-shell, \.desktop-overlay-root, \.desktop-theme-preview-surface, \.dark\)\s*\{[^}]*--desktop-sidebar-font-size:\s*var\(--po-type-left-sidebar-content\);[^}]*--desktop-sidebar-font-size-meta:\s*var\(--po-type-left-sidebar-meta\);/s,
    );
  });
});
