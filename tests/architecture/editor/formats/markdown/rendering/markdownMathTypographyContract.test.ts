import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const markdownContentCss = readFileSync(
  join(process.cwd(), "packages/shared-ui/src/styles/editor/markdown-content.css"),
  "utf8",
);
const markdownMathCss = readFileSync(
  join(process.cwd(), "packages/shared-ui/src/styles/editor/markdown-math.css"),
  "utf8",
);
const editorCss = readFileSync(
  join(process.cwd(), "packages/shared-ui/src/styles/editor.css"),
  "utf8",
);

describe("markdown math typography contract", () => {
  it("keeps editor prose fonts from reaching math widgets", () => {
    // Prose fonts are inherited theme variables (b6fa064f). A forced descendant
    // override is what used to reach KaTeX, so none may return, and nothing in
    // the content layer may restyle KaTeX glyph fonts.
    expect(markdownContentCss).not.toMatch(/font-family:[^;}]*!important/);
    expect(markdownContentCss).not.toMatch(/\.katex[^{]*\{[^}]*font-family/s);
  });

  it("leaves math font-role mapping to the upstream KaTeX stylesheet", () => {
    expect(editorCss).toContain('@import "katex/dist/katex.min.css";');
    expect(markdownMathCss).not.toContain("font-family: revert");
    expect(markdownContentCss).not.toContain("font-family: revert");
    expect(markdownMathCss).not.toMatch(/font-family:\s*KaTeX_/);
    expect(markdownMathCss).not.toMatch(/\.katex[^\{]*\.size[1-4][^\{]*\{/);
  });
});
