import { describe, expect, it } from "vitest";
import { isHtmlDocumentEmpty } from "../../../../../packages/shared-ui/src/editor/viewers/html/htmlDocumentEmpty";

describe("empty HTML documents", () => {
  it.each(["", " \n", "<!-- empty -->", '<!doctype html><html><head><title>Untitled</title><meta charset="utf-8"></head><body>\n</body></html>'])(
    "recognizes an empty page without changing its source: %s", (source) => {
      expect(isHtmlDocumentEmpty(source)).toBe(true);
    },
  );
  it.each(['<h1>Hello</h1>', '<img src="cover.png">', '<svg></svg>', '<canvas></canvas>',
    '<div id="root"></div><script>document.querySelector("#root").textContent="Ready"</script>',
    '<script>document.body.textContent="Ready"</script>', '<style>body::before{content:"Hello"}</style>',
    '<link rel="stylesheet" href="page.css">', '<meta http-equiv="refresh" content="0;url=next.html">'])(
    "keeps visible and potentially dynamic content in the preview: %s", (source) => {
      expect(isHtmlDocumentEmpty(source)).toBe(false);
    },
  );
});
