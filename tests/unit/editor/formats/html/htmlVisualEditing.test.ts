import { describe, expect, it, vi } from "vitest";
import { CodeMirrorDocumentModel } from "../../../../../packages/shared-ui/src/editor/document-session/CodeMirrorDocumentModel";
import { HtmlVisualSession } from "../../../../../packages/shared-ui/src/editor/viewers/html/HtmlVisualSession";
import { parseHtmlSource } from "../../../../../packages/shared-ui/src/editor/viewers/html/htmlSourceIndex";
import { buildHtmlEditingProjection } from "../../../../../packages/shared-ui/src/editor/viewers/html/htmlPreviewProjection";
import { decodeHtmlBridgeMessage } from "../../../../../packages/shared-ui/src/editor/viewers/html/htmlBridgeProtocol";
import { imageSourceReference } from "../../../../../packages/shared-ui/src/editor/viewers/html/htmlImageReference";
import { compileHtmlEdit } from "../../../../../packages/shared-ui/src/editor/viewers/html/htmlEditCompiler";
import { buildHtmlPreviewDocument } from "../../../../../packages/shared-ui/src/editor/viewers/html/HtmlPreviewFrame";

function setup(content: string) {
  const model = new CodeMirrorDocumentModel(content, undefined, true);
  const invalidated = vi.fn();
  const session = new HtmlVisualSession(model, "pages/index.html", invalidated);
  const id = (tag: string, index = 0) => [...session.index.targets.values()].filter((target) => target.tag === tag)[index]!.id;
  return { model, session, id, invalidated };
}

describe("HTML source-based visual editing", () => {
  it("keeps imported references portable when workbench identities are encoded Resource URIs", () => {
    expect(imageSourceReference("file:///project/%E4%B8%AD%20x/page.html", "file:///project/%E4%B8%AD%20x/image.png", null)).toBe("image.png");
    expect(imageSourceReference("file:///project/%E4%B8%AD%20x/page.html", "file:///project/%E4%B8%AD%20x/image.png", "assets/")).toBe("../image.png");
  });
  it("preserves an unquoted attribute's trailing slash when inserting another attribute", () => {
    const { model, session, id } = setup('<img src=images/><img src="image.png"/>');
    session.apply(id("img"), model.revision, { kind: "attribute", name: "alt", value: "First" }, "a");
    session.apply(id("img", 1), model.revision, { kind: "attribute", name: "alt", value: "Second" }, "b");
    expect(session.read(id("img")).attrs.get("src")).toBe("images/");
    expect(model.readSnapshot().content).toBe('<img src=images/ alt="First"><img src="image.png" alt="Second"/>');
  });
  it("does not snapshot or parse the complete document during a local typing gesture", () => {
    const { model, session, id } = setup(`<p>A</p><!--${"padding".repeat(65000)}-->`);
    const snapshot = vi.spyOn(model, "readSnapshot");
    const clock = vi.spyOn(Date, "now").mockReturnValue(10000);
    try {
      session.apply(id("p"), model.revision, { kind: "text", value: "AB" }, "gesture");
      clock.mockReturnValue(20000);
      session.apply(id("p"), model.revision, { kind: "text", value: "ABC" }, "gesture");
      expect(snapshot).not.toHaveBeenCalled();
      model.moveHistory("undo");
      expect(model.editorState.doc.sliceString(0, 8)).toBe("<p>A</p>");
    } finally { clock.mockRestore(); }
  });
  it("fails closed for excessive source size, DOM count, depth and non-UTF8 declarations", () => {
    expect(parseHtmlSource(`<p>${"x".repeat(512 * 1024)}</p>`, "page.html").editable).toBe(false);
    expect(parseHtmlSource("<p>a</p>".repeat(6500), "page.html").editable).toBe(false);
    expect(parseHtmlSource("<div>".repeat(260) + "x" + "</div>".repeat(260), "page.html").editable).toBe(false);
    expect(parseHtmlSource('<meta charset="iso-8859-1"><p>Hello</p>', "page.html").editable).toBe(false);
  });
  it("opens losslessly, retaining BOM, CRLF, comments, entities, quotes and Unicode", () => {
    const source = '\ufeff<!DOCTYPE html>\r\n<!-- keep -->\r\n<h1 class=\'title\'>你好😀 &amp; x</h1>\r\n';
    const { model, session } = setup(source);
    expect(model.readSnapshot().content).toBe(source);
    expect(session.valid).toBe(true);
    const originalRevision = model.revision;
    buildHtmlEditingProjection(session.index, null, session.id);
    expect(model.readSnapshot().content).toBe(source);
    expect(model.revision).toBe(originalRevision);
  });

  it("edits repeated text by source identity and keeps all bytes outside its text range", () => {
    const { model, session, id } = setup('<!DOCTYPE html>\r\n<!-- untouched -->\r\n<p class=\'a\'>Same</p><p class="a">Same</p>\r\n');
    session.apply(id("p", 1), model.revision, { kind: "text", value: '你好😀 <a> & "b"\nNext' }, "typing");
    expect(model.readSnapshot().content).toBe('<!DOCTYPE html>\r\n<!-- untouched -->\r\n<p class=\'a\'>Same</p><p class="a">你好😀 &lt;a&gt; &amp; "b"<br>Next</p>\r\n');
  });

  it("maps later targets after repeated text changes and attribute insertions", () => {
    const { model, session, id } = setup('<h1>A</h1><p>B</p><img src="old.png" alt=\'Old\'>');
    for (const value of ["", "Z", "Hello 😀", "Done"]) session.apply(id("h1"), model.revision, { kind: "text", value }, "typing");
    session.apply(id("h1"), model.revision, { kind: "style", property: "color", value: "red" }, "color");
    session.apply(id("p"), model.revision, { kind: "text", value: "Paragraph" }, "p");
    session.apply(id("img"), model.revision, { kind: "attribute", name: "src", value: "assets/new.png" }, "image");
    session.apply(id("img"), model.revision, { kind: "attribute", name: "alt", value: "I'm new" }, "alt");
    expect(model.readSnapshot().content).toContain('<h1 style="color: red">Done</h1><p>Paragraph</p><img src="assets/new.png" alt=\'I&#39;m new\'>');
  });

  it("supports empty text regions and table-cell attribute locations", () => {
    const { model, session, id } = setup('<table><tbody><tr><td></td></tr></tbody></table>');
    session.apply(id("td"), model.revision, { kind: "text", value: "Hello" }, "t");
    session.apply(id("td"), model.revision, { kind: "style", property: "padding", value: "12px" }, "p");
    session.apply(id("td"), model.revision, { kind: "text", value: "Again" }, "t2");
    expect(model.readSnapshot().content).toBe('<table><tbody><tr><td style="padding: 12px">Again</td></tr></tbody></table>');
  });

  it("does not flatten nested emphasis or links", () => {
    const { model, session, id } = setup('<p>Hello <strong>world</strong> <a href="https://example.com">link</a></p>');
    expect(() => session.apply(id("p"), model.revision, { kind: "text", value: "flatten" }, "t")).toThrow("unsupported");
    session.apply(id("strong"), model.revision, { kind: "text", value: "你好" }, "t");
    expect(model.readSnapshot().content).toBe('<p>Hello <strong>你好</strong> <a href="https://example.com">link</a></p>');
  });

  it.each(['<p>{{ name }}</p>', '<% name %>', '<div a=\"unterminated>', '<img src=a src=b>'])("rejects ambiguous or template input: %s", (source) => {
    expect(parseHtmlSource(source, "index.html").editable).toBe(false);
  });
  it("rejects template extensions and responsive image replacement", () => {
    expect(parseHtmlSource('<p>Hello</p>', "index.ejs").editable).toBe(false);
    const { model, session, id } = setup('<picture><source srcset="a.png"><img src="b.png"></picture>');
    expect(() => session.apply(id("img"), model.revision, { kind: "attribute", name: "src", value: "c.png" }, "i")).toThrow("unsupported");
  });

  it("does not create a transaction for unchanged text", () => {
    const { model, session, id } = setup('<p>&#65; &amp; B</p>');
    const revision = model.revision;
    session.apply(id("p"), revision, { kind: "text", value: "A & B" }, "t");
    expect(model.revision).toBe(revision);
    expect(model.readSnapshot().content).toBe('<p>&#65; &amp; B</p>');
  });

  it("preserves a single history through detached edits, undo and source edits", () => {
    const { model, session, id, invalidated } = setup('<p>A</p>');
    session.apply(id("p"), model.revision, { kind: "text", value: "AB" }, "typing");
    session.apply(id("p"), model.revision, { kind: "text", value: "ABC" }, "typing");
    expect(model.moveHistory("undo")).toBe(true);
    expect(model.readSnapshot().content).toBe('<p>A</p>');
    expect(invalidated).toHaveBeenCalledOnce();
    expect(model.moveHistory("redo")).toBe(true);
    expect(model.readSnapshot().content).toBe('<p>ABC</p>');
  });

  it("retires stale commands and clears history on an external baseline", () => {
    const { model, session, id } = setup('<p>A</p>');
    const target = id("p"), revision = model.revision;
    session.apply(target, revision, { kind: "text", value: "local" }, "t");
    expect(() => session.apply(target, revision, { kind: "text", value: "stale" }, "t")).toThrow("stale");
    model.replaceContent('<p>Disk\r\n😀</p>');
    expect(session.valid).toBe(false);
    expect(model.moveHistory("undo")).toBe(false);
    expect(model.readSnapshot().content).toBe('<p>Disk\r\n😀</p>');
  });

  it("validates the complete transaction before any source mutation", () => {
    const { model } = setup("abcdef");
    expect(model.applyLocalEdits(model.revision, [{ from: 0, to: 1, expectedText: "a", insert: "A" },
      { from: 3, to: 4, expectedText: "wrong", insert: "D" }], "g")).toBe(false);
    expect(model.readSnapshot().content).toBe("abcdef");
    model.setInputEnabled(false);
    expect(model.applyLocalEdits(model.revision, [{ from: 0, to: 1, expectedText: "a", insert: "A" }], "g")).toBe(false);
  });

  it("changes only the selected inline declaration and respects important", () => {
    const { model, session, id } = setup('<p style=\'padding: 10px; color: red; /*keep*/ margin: 0\'>A</p><p class="same">B</p>');
    session.apply(id("p"), model.revision, { kind: "style", property: "color", value: "blue" }, "g");
    expect(model.readSnapshot().content).toBe('<p style=\'padding: 10px; color: blue; /*keep*/ margin: 0\'>A</p><p class="same">B</p>');
    const important = setup('<p style="color: red !important">A</p>');
    expect(() => important.session.apply(important.id("p"), important.model.revision, { kind: "style", property: "color", value: "blue" }, "g")).toThrow("unsupported");
  });
  it.each(["url(https://evil.example)", "red; position: fixed", "expression(alert(1))", "red !important"])("rejects invalid style payload %s", (value) => {
    const { model, session, id } = setup('<p>A</p>');
    expect(() => compileHtmlEdit(session.index.targets.get(id("p"))!, null, model.editorState, { kind: "style", property: "color", value })).toThrow("invalid");
    expect(model.readSnapshot().content).toBe('<p>A</p>');
  });
});

describe("HTML projection and resource boundaries", () => {
  it("builds preview headers structurally and honors the original relative base", () => {
    const source = '<!doctype html><html><head data-note=">"><base href="assets/"><style>p:after{content:"</body>"}</style></head><body><p>Hi</p></body></html>';
    const projected = buildHtmlPreviewDocument(source, "puppyone-local://workspace/pages/index.html", { sandbox: "", csp: "script-src 'none'" });
    expect(projected).toContain('href="puppyone-local://workspace/pages/assets/"');
    expect(projected.indexOf("Content-Security-Policy")).toBeLessThan(projected.indexOf('<style>'));
    expect(projected.match(/<base /g)).toHaveLength(1);
  });
  it("strips active markup and forged mapping while preserving original source", () => {
    const source = '<!doctype html><html><head><base href="./assets/"><meta http-equiv="refresh" content="0;url=https://evil.example"><script>alert(1)</script></head><body onload="bad()"><p data-puppyone-html-target="forged">A</p><iframe srcdoc="bad"></iframe><img src="x.png" onerror="bad()"><a href="javascript:bad()">link</a></body></html>';
    const { model, session } = setup(source);
    const projected = buildHtmlEditingProjection(session.index, "https://example.com/page.html", session.id);
    expect(projected).not.toContain("alert(1)");
    expect(projected).not.toContain("bad()");
    expect(projected).not.toContain('target="forged"');
    expect(projected).not.toContain("<iframe");
    expect(projected).not.toContain('http-equiv="refresh"');
    expect(projected).toContain('base href="https://example.com/assets/"');
    expect(projected).toContain("script-src-attr 'none'");
    expect(model.readSnapshot().content).toBe(source);
  });
  it("calculates portable image references respecting base and Unicode paths", () => {
    expect(imageSourceReference("pages/index.html", "pages/新 图.png", null)).toBe("%E6%96%B0%20%E5%9B%BE.png");
    expect(imageSourceReference("pages/index.html", "pages/image.png", "assets/")).toBe("../image.png");
    expect(() => imageSourceReference("pages/index.html", "pages/image.png", "https://example.com/")).toThrow("unsupported-base");
  });
  it("rejects oversized, non-finite and unrecognized bridge messages", () => {
    expect(decodeHtmlBridgeMessage({ type: "patch", path: "secret" })).toBeNull();
    expect(decodeHtmlBridgeMessage({ type: "ready", ids: Array(12001).fill("t0") })).toBeNull();
    expect(decodeHtmlBridgeMessage({ type: "selection", id: "t0", edit: true, rect: { x: NaN, y: 0, width: 10, height: 10 }, styles: {} })).toBeNull();
  });
});
