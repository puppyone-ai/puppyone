/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { findDocumentSurface, findMarkdownSurfaceEditor, isDocumentSurfaceCommitted } from "../../../../src/performance/documentSurfaceProbe";

afterEach(() => document.body.replaceChildren());

describe("performance probe document identity and presentation", () => {
  it("inspects the requested staged editor while the previous document is still visible", () => {
    document.body.innerHTML = '<div class="document-surface-slot" data-surface-key="a.md" data-surface-state="committed" data-surface-ready="true"><div class="markdown-codemirror-editor" id="old"></div></div><div class="document-surface-slot" data-surface-key="b.md" data-surface-state="staging" data-surface-ready="false"><div class="markdown-codemirror-editor" id="next"></div></div>';
    expect(findMarkdownSurfaceEditor("b.md")?.id).toBe("next");
    expect(findMarkdownSurfaceEditor("missing.md")).toBeNull();
    expect(isDocumentSurfaceCommitted(findDocumentSurface("a.md"))).toBe(true);
    expect(isDocumentSurfaceCommitted(findDocumentSurface("b.md"))).toBe(false);
  });
  it("requires the host handoff even when the inner preview is already ready", () => {
    document.body.innerHTML = '<div class="document-surface-slot" data-surface-key="note.md" data-surface-state="staging" data-surface-ready="false"><div class="markdown-codemirror-editor" data-preview-state="ready"></div></div>';
    const surface = findDocumentSurface("note.md")!;
    expect(isDocumentSurfaceCommitted(surface)).toBe(false);
    surface.dataset.surfaceState = "committed";
    expect(isDocumentSurfaceCommitted(surface)).toBe(false);
    surface.dataset.surfaceReady = "true";
    expect(isDocumentSurfaceCommitted(surface)).toBe(true);
    surface.remove();
    expect(isDocumentSurfaceCommitted(surface)).toBe(false);
  });
  it("matches literal document paths containing selector punctuation", () => {
    const surface = document.createElement("div");
    surface.className = "document-surface-slot";
    surface.dataset.surfaceKey = 'notes/[draft] "review".md';
    document.body.appendChild(surface);
    expect(findDocumentSurface(surface.dataset.surfaceKey)).toBe(surface);
  });
});
