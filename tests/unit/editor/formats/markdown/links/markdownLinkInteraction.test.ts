import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import {
  MarkdownLinkInteractionSession,
  resolveMarkdownHrefInteraction,
  resolveWikiLinkInteraction,
  type MarkdownLinkResolutionContext,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/state/markdownLinkInteraction";
import {
  createMarkdownHeadingIndex,
  markdownHeadingIndexField,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownHeadingIndex";
import { createMarkdownLinkGraph } from "../../../../../../packages/shared-ui/src/editor/markdown/core/links/markdownLinkGraph";

function context(
  overrides: Partial<MarkdownLinkResolutionContext> = {},
): MarkdownLinkResolutionContext {
  return {
    documentPath: "notes/current.md",
    linkGraph: createMarkdownLinkGraph([
      { path: "notes/current.md", name: "current.md", content: "# Current" },
      { path: "notes/target.md", name: "target.md", content: "# Target" },
    ]),
    linkCommands: {
      openWikiLink: vi.fn(),
      openExternalUrl: vi.fn(),
    },
    hasSameDocumentTarget: (fragment) => fragment === "#current",
    ...overrides,
  };
}

describe("Markdown link interaction policy", () => {
  it("classifies only executable destinations as navigation", () => {
    expect(resolveMarkdownHrefInteraction("#current", context())).toMatchObject({
      action: "navigate",
      kind: "same-document",
    });
    expect(resolveMarkdownHrefInteraction("target.md", context())).toMatchObject({
      action: "navigate",
      kind: "workspace",
    });
    expect(resolveMarkdownHrefInteraction("https://example.com", context())).toMatchObject({
      action: "navigate",
      kind: "external",
    });
    expect(resolveMarkdownHrefInteraction("https://example.com", context({ editing: true }))).toMatchObject({
      action: "edit",
    });
  });

  it("fails closed for missing targets, unsafe hrefs, and absent host commands", () => {
    expect(resolveMarkdownHrefInteraction("#missing", context())).toMatchObject({
      action: "unavailable",
      reason: "unresolved",
    });
    expect(resolveMarkdownHrefInteraction("javascript:alert(1)", context())).toMatchObject({
      action: "unavailable",
      reason: "unsafe",
    });
    expect(resolveMarkdownHrefInteraction("https://example.com", context({ linkCommands: {} }))).toMatchObject({
      action: "unavailable",
      reason: "missing-capability",
    });
    expect(resolveWikiLinkInteraction("missing", context())).toMatchObject({
      action: "unavailable",
      reason: "unresolved",
    });
  });

  it("indexes ATX, setext, Unicode, and duplicate heading fragments", () => {
    const index = createMarkdownHeadingIndex([
      "# Hello **world**",
      "",
      "设计哲学",
      "------",
      "",
      "# Repeat",
      "# Repeat",
    ].join("\n"));

    expect(index.has("hello-world")).toBe(true);
    expect(index.has("设计哲学")).toBe(true);
    expect(index.has("repeat")).toBe(true);
    expect(index.has("repeat-1")).toBe(true);
  });

  it("keeps the pane-local heading index exact across incremental edits", () => {
    let state = EditorState.create({
      doc: [
        "# First",
        "",
        "设计哲学",
        "------",
        "",
        "# Repeat",
        "# Repeat",
      ].join("\n"),
      extensions: [markdownHeadingIndexField],
    });

    const first = state.doc.toString().indexOf("First");
    state = state.update({ changes: { from: first, to: first + 5, insert: "Renamed" } }).state;
    expectHeadingIndexToMatchFullBuild(state);

    const underline = state.doc.toString().indexOf("------");
    state = state.update({ changes: { from: underline, to: underline + 6, insert: "ordinary" } }).state;
    expectHeadingIndexToMatchFullBuild(state);

    const repeated = state.doc.toString().lastIndexOf("# Repeat");
    state = state.update({ changes: { from: repeated, insert: "## Inserted\n" } }).state;
    expectHeadingIndexToMatchFullBuild(state);
    expect(state.field(markdownHeadingIndexField).has("repeat-1")).toBe(true);
  });
});

function expectHeadingIndexToMatchFullBuild(state: EditorState) {
  const incremental = state.field(markdownHeadingIndexField);
  const rebuilt = createMarkdownHeadingIndex(state.doc);
  expect([...incremental.positions.entries()]).toEqual([...rebuilt.positions.entries()]);
  expect(incremental.headings).toEqual(rebuilt.headings);
}

describe("Markdown link pointer gesture", () => {
  it("activates only a stationary click that starts and ends without a range selection", () => {
    const session = new MarkdownLinkInteractionSession();
    const activation = { href: "target.md", wikiTarget: null };
    session.beginPointer(activation, { clientX: 10, clientY: 10 }, 4, "revision-1");
    session.updatePointer({ clientX: 12, clientY: 12 });
    expect(session.completePointer(true, "revision-1", activation)).toEqual({
      activation,
      restoreSelectionAt: 4,
    });

    session.beginPointer(activation, { clientX: 10, clientY: 10 }, 4, "revision-1");
    session.updatePointer({ clientX: 30, clientY: 10 });
    expect(session.completePointer(true, "revision-1")).toBeNull();

    session.beginPointer(activation, { clientX: 10, clientY: 10 }, 4, "revision-1");
    expect(session.completePointer(true, "revision-1")).toBeNull();

    session.beginPointer(activation, { clientX: 10, clientY: 10 }, null, "revision-1");
    expect(session.completePointer(true, "revision-1")).toBeNull();

    session.beginPointer(activation, { clientX: 10, clientY: 10 }, 4, "revision-1");
    expect(session.completePointer(false, "revision-1")).toBeNull();

    session.beginPointer(activation, { clientX: 10, clientY: 10 }, 4, "revision-1");
    expect(session.completePointer(true, "revision-2")).toBeNull();

    session.beginPointer(activation, { clientX: 10, clientY: 10 }, 4, "revision-1");
    expect(session.completePointer(true, "revision-1", {
      href: "another.md",
      wikiTarget: null,
    })).toBeNull();
  });

  it("suppresses only the browser click paired with a handled pointer release", () => {
    const session = new MarkdownLinkInteractionSession();

    session.recordHandledPointerUp(1_000);
    expect(session.consumeDuplicateClick(1_100)).toBe(true);
    expect(session.consumeDuplicateClick(1_101)).toBe(false);
    expect(session.consumeDuplicateClick(2_000)).toBe(false);
  });
});
