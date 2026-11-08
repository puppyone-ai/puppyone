import { describe, expect, it } from "vitest";
import { markPreviewDocumentLinks } from "../../../../../src/shared-ui/editor/viewers/html/HtmlPreviewFrame";

describe("markPreviewDocumentLinks", () => {
  it("marks workspace-relative document links", () => {
    const out = markPreviewDocumentLinks(`<a href="topics/foo.md">Open</a>`);
    expect(out).toContain('data-puppyone-open="topics/foo.md"');
  });

  it("leaves external links untouched", () => {
    const out = markPreviewDocumentLinks(`<a href="https://example.com">ext</a>`);
    expect(out).not.toContain("data-puppyone-open");
  });

  it("leaves fragment links untouched", () => {
    const out = markPreviewDocumentLinks(`<a href="#s">jump</a>`);
    expect(out).not.toContain("data-puppyone-open");
  });

  it("does not mark non-document files", () => {
    const out = markPreviewDocumentLinks(`<a href="a.png">img</a>`);
    expect(out).not.toContain("data-puppyone-open");
  });
});
