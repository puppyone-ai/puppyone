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
  it("excludes math widgets from editor prose font overrides", () => {
    expect(markdownContentCss).toContain(".cm-md-math-inline-widget");
    expect(markdownContentCss).toContain(".cm-md-math-block-widget");
    expect(markdownContentCss).toContain(
      "*:not(:is(.cm-md-math-inline-widget, .cm-md-math-block-widget, .cm-md-math-inline-widget *, .cm-md-math-block-widget *))",
    );
    expect(markdownContentCss).toContain("*:not(:is(.katex, .katex *))");
  });

  it("leaves math font-role mapping to the upstream KaTeX stylesheet", () => {
    expect(editorCss).toContain('@import "katex/dist/katex.min.css";');
    expect(markdownMathCss).not.toContain("font-family: revert");
    expect(markdownContentCss).not.toContain("font-family: revert");
    expect(markdownMathCss).not.toMatch(/font-family:\s*KaTeX_/);
    expect(markdownMathCss).not.toMatch(/\.katex[^\{]*\.size[1-4][^\{]*\{/);
  });
});
