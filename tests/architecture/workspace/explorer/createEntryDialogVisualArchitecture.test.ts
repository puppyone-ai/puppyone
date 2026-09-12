import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fileActionCss = readFileSync(
  new URL("../../../../src/styles/file-actions.css", import.meta.url),
  "utf8",
);

describe("create entry dialog visual architecture", () => {
  it("uses one outer inset for its top, sides, and bottom", () => {
    const dialogRule = getRule(".desktop-create-entry-dialog");
    const headerRule = getRule(".desktop-create-entry-dialog .desktop-dialog-header");
    const bodyRule = getRule(".desktop-create-entry-dialog .desktop-file-dialog-body");
    const footerRule = getRule(".desktop-create-entry-dialog .desktop-dialog-footer");

    expect(dialogRule).toContain("--desktop-create-entry-inset: 20px;");
    expect(headerRule).toContain("padding-block: var(--desktop-create-entry-inset) 10px;");
    expect(headerRule).toContain("padding-inline: var(--desktop-create-entry-inset);");
    expect(bodyRule).toContain("padding-inline: var(--desktop-create-entry-inset);");
    expect(footerRule).toContain("padding-inline: var(--desktop-create-entry-inset);");
    expect(footerRule).toContain("padding-block-end: var(--desktop-create-entry-inset);");
  });

  it("uses a compact single-line title treatment", () => {
    expect(fileActionCss).toMatch(
      /\.desktop-create-entry-dialog \.desktop-dialog-title-row\s*\{[^}]*align-items:\s*center;/s,
    );
  });

  it("does not reserve label spacing above its single input", () => {
    const inputRule = getRule(".desktop-create-entry-dialog .desktop-dialog-field input");

    expect(inputRule).toContain("margin-top: 0;");
  });
});

function getRule(selector: string): string | undefined {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return fileActionCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s"))?.[1];
}
