import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const codeEditorCss = readFileSync(
  new URL("../../../../../packages/shared-ui/src/styles/editor/code-editor.css", import.meta.url),
  "utf8",
);

describe("code editor visual architecture", () => {
  it("keeps the gutter integrated with the editor surface", () => {
    const gutters = readCssBlock(codeEditorCss, ".code-codemirror-editor .cm-gutters");
    const lineNumbers = readCssBlock(
      codeEditorCss,
      ".code-codemirror-editor .cm-lineNumbers .cm-gutterElement",
    );

    expect(gutters).toContain("border-right: 0;");
    expect(gutters).toContain("background: var(--po-editor-bg);");
    expect(lineNumbers).toContain("min-width: 36px;");
    expect(lineNumbers).toContain("font-variant-numeric: tabular-nums;");
  });

  it("reveals folding controls only on hover or the active line", () => {
    const foldMarker = readCssBlock(
      codeEditorCss,
      ".code-codemirror-editor .cm-foldGutter .cm-gutterElement span",
    );
    expect(foldMarker).toContain("opacity: 0;");
    expect(codeEditorCss).toContain(".cm-gutterElement.cm-activeLineGutter span");
  });

  it("keeps code comments quiet without changing their letterforms", () => {
    const comments = readCssBlock(codeEditorCss, ".code-codemirror-editor .cm-code-comment");
    expect(comments).toContain("font-style: normal;");
  });
});

function readCssBlock(css: string, selector: string): string {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`Missing CSS block for ${selector}`);
  const bodyStart = start + marker.length;
  const end = css.indexOf("\n}", bodyStart);
  if (end < 0) throw new Error(`Unclosed CSS block for ${selector}`);
  return css.slice(bodyStart, end);
}
