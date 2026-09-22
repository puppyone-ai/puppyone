import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const codeEditorCss = readFileSync(
  new URL("../../../../../packages/shared-ui/src/styles/editor/code-editor.css", import.meta.url),
  "utf8",
);
const documentPreviewCss = readFileSync(
  new URL("../../../../../packages/shared-ui/src/styles/editor/document-preview.css", import.meta.url),
  "utf8",
);

describe("binary fallback visual architecture", () => {
  it("keeps the fallback surface flat and independent from the code preview frame", () => {
    expect(codeEditorCss).not.toContain(".document-preview");

    const surface = readCssBlock(documentPreviewCss, ".document-preview");
    expect(surface).toContain("border: 0;");
    expect(surface).toContain("border-radius: 0;");
    expect(surface).toContain("background: var(--po-editor-bg);");

    const summary = readCssBlock(documentPreviewCss, ".document-preview__summary");
    expect(summary).toContain("width: fit-content;");
    expect(summary).toContain("max-width: 100%;");
    expect(summary).not.toContain("aspect-ratio:");
    expect(summary).toContain("background: repeating-linear-gradient(");
    expect(summary).toContain("var(--po-text-muted) 32%");
    expect(summary).toContain("border: 1px solid color-mix(in srgb, var(--po-text-muted) 42%, transparent);");
    expect(summary).toContain("border-radius: 0;");
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
