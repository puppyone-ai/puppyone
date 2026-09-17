/**
 * @vitest-environment happy-dom
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMarkdownBlockComplexity,
  decideMarkdownBlockExecution,
  MARKDOWN_TABLE_MODEL_COLUMN_LIMIT,
  MARKDOWN_TABLE_MODEL_ROW_BYTE_LIMIT,
  MARKDOWN_TABLE_MODEL_ROW_LIMIT,
  MARKDOWN_TABLE_MODEL_SOURCE_BYTE_LIMIT,
  MARKDOWN_RENDER_BUDGET_VERSION,
  resetMarkdownBlockBudgetDiagnostics,
} from "../../../../../../packages/shared-ui/src/editor/markdown/core/plans/markdownBlockExecution";
import { MarkdownBlockVirtualizer } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/blockVirtualizer";
import { createMarkdownTableWindowController } from "../../../../../../packages/shared-ui/src/editor/markdown/features/table/tableWindowController";
import type { MarkdownTableRow } from "../../../../../../packages/shared-ui/src/editor/markdown/features/table/tableModel";
import type { MarkdownEmbedHost } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/embedHost";
import { createSanitizedBlockHtmlFragment } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/sanitizeHtml";
import { resolveMarkdownImageSrcset } from "../../../../../../packages/shared-ui/src/editor/markdown/features/image/markdownImageModel";
import { getMarkdownTableBlock } from "../../../../../../packages/shared-ui/src/editor/markdown/features/table/tableModel";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { compileCodeBlockElementPlan } from "../../../../../../packages/shared-ui/src/editor/markdown/features/code-block/codeBlockPlan";

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  resetMarkdownBlockBudgetDiagnostics();
});

describe("Markdown render-budget policy", () => {
  it("accounts for the possible syntax-token DOM cost of code blocks", () => {
    const code = "const values = [1, 2, 3].map((value) => value * 2);";
    const plan = compileCodeBlockElementPlan({
      kind: "fence",
      from: 0,
      to: code.length + 10,
      markerRanges: [],
      blockData: {
        kind: "fence",
        language: "ts",
        sourceReference: null,
        code,
      },
    });

    expect(plan.presentation).toBe("blockAtom");
    if (plan.presentation !== "blockAtom") throw new Error("Expected an editable code block");
    expect(plan.complexity.estimatedDomNodes).toBeGreaterThan(8);
  });

  it("uses stable, versioned transitions at the table and HTML thresholds", () => {
    const tableAtRichLimit = createMarkdownBlockComplexity("", {
      sourceBytes: 8_000,
      sourceLines: 120,
      logicalItems: 120,
      estimatedDomNodes: 4_000,
      nestingDepth: 5,
      assetCount: 0,
    });
    const tableOverRichLimit = { ...tableAtRichLimit, logicalItems: 121 };
    const htmlOverSoftLimit = createMarkdownBlockComplexity("", {
      sourceBytes: 48 * 1024 + 1,
      sourceLines: 200,
      logicalItems: 300,
      estimatedDomNodes: 700,
      nestingDepth: 20,
      assetCount: 2,
    });
    const htmlOverHardLimit = { ...htmlOverSoftLimit, sourceBytes: 256 * 1024 + 1 };

    expect(decideMarkdownBlockExecution("table", tableAtRichLimit, "normal")).toMatchObject({
      mode: "rich",
      budgetVersion: MARKDOWN_RENDER_BUDGET_VERSION,
    });
    expect(decideMarkdownBlockExecution("table", tableOverRichLimit, "normal")).toMatchObject({
      mode: "windowed",
      overscanItems: 8,
    });
    expect(decideMarkdownBlockExecution("table", {
      ...tableOverRichLimit,
      maximumItemBreadth: MARKDOWN_TABLE_MODEL_COLUMN_LIMIT + 1,
    }, "normal")).toMatchObject({
      mode: "visibleSource",
      reason: "logical-items",
    });
    expect(decideMarkdownBlockExecution("table", {
      ...tableOverRichLimit,
      sourceBytes: MARKDOWN_TABLE_MODEL_SOURCE_BYTE_LIMIT + 1,
    }, "normal")).toMatchObject({
      mode: "visibleSource",
      reason: "source-bytes",
    });
    expect(decideMarkdownBlockExecution("htmlBlock", htmlOverSoftLimit, "normal")).toMatchObject({
      mode: "deferred",
      reason: "source-bytes",
    });
    expect(decideMarkdownBlockExecution("htmlBlock", htmlOverHardLimit, "normal")).toMatchObject({
      mode: "visibleSource",
      reason: "source-bytes",
    });
  });

  it("keeps expensive code and diagrams out of unconditional rich mount", () => {
    const code = createMarkdownBlockComplexity("", {
      sourceBytes: 20_000,
      sourceLines: 513,
      logicalItems: 513,
      estimatedDomNodes: 513,
      nestingDepth: 1,
      assetCount: 0,
    });
    const diagram = createMarkdownBlockComplexity("", {
      sourceBytes: 33 * 1024,
      sourceLines: 200,
      logicalItems: 900,
      estimatedDomNodes: 1_800,
      nestingDepth: 8,
      assetCount: 0,
    });

    expect(decideMarkdownBlockExecution("codeBlock", code, "normal")).toMatchObject({
      mode: "visibleSource",
      reason: "source-lines",
    });
    expect(decideMarkdownBlockExecution("mermaid", diagram, "normal")).toMatchObject({
      mode: "deferred",
      reason: "async-work",
    });
  });
});

describe("Markdown nested block virtualizer", () => {
  it("indexes variable item sizes, overscan, and pinned rows without linear lookup", () => {
    const virtualizer = new MarkdownBlockVirtualizer(10, (index) => (index + 1) * 10);

    expect(virtualizer.getRange(25, 65, 1, [8])).toMatchObject({
      startIndex: 0,
      endIndex: 4,
      visibleStartIndex: 1,
      visibleEndIndex: 3,
      indexes: [0, 1, 2, 3, 4, 8],
      totalSize: 550,
    });
    expect(virtualizer.updateSize(0, 25)).toBe(15);
    expect(virtualizer.getOffset(2)).toBe(45);
    expect(virtualizer.getTotalSize()).toBe(565);
  });

  it("mounts a bounded table row window and can reveal an offscreen logical row", () => {
    const scrollDOM = document.createElement("div");
    const wrapper = document.createElement("div");
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    wrapper.appendChild(table);
    scrollDOM.appendChild(wrapper);
    document.body.appendChild(scrollDOM);

    Object.defineProperty(scrollDOM, "getBoundingClientRect", {
      configurable: true,
      value: () => rect(0, 0, 800, 320),
    });
    Object.defineProperty(tbody, "getBoundingClientRect", {
      configurable: true,
      value: () => rect(0, 100 - scrollDOM.scrollTop, 800, 40_000),
    });

    const rows = Array.from({ length: 1_000 }, (_, index): MarkdownTableRow => ({
      header: false,
      lineTo: index + 1,
      cells: [{
        editable: true,
        from: index,
        to: index + 1,
        text: `row ${index}`,
      }],
    }));
    const disposedRows: number[] = [];
    const layout = {
      observe: () => () => undefined,
      schedule: <T,>(_key: object, read: () => T, write: (value: T) => void) => write(read()),
      request: () => undefined,
      dispose: () => undefined,
    };
    const controller = createMarkdownTableWindowController({
      bodyRowCount: rows.length,
      columnCount: 1,
      createRow: (bodyIndex) => {
        const row = document.createElement("tr");
        row.dataset.mdTableRow = String(bodyIndex + 1);
        row.appendChild(document.createElement("td"));
        return row;
      },
      disposeRow: (row) => disposedRows.push(Number(row.dataset.mdTableBodyIndex)),
      getBodyRow: (bodyIndex) => rows[bodyIndex],
      globalRowOffset: 1,
      host: { layout, requestMeasure: () => undefined } as unknown as MarkdownEmbedHost,
      overscan: 8,
      table,
      tbody,
      view: { scrollDOM } as unknown as EditorView,
      wrapper,
    });

    expect(controller.getMountedRowCount()).toBeLessThan(50);
    expect(tbody.querySelectorAll("tr[data-md-table-body-index]").length).toBeLessThan(50);

    controller.revealRow(900);

    expect(scrollDOM.scrollTop).toBeGreaterThan(20_000);
    expect(tbody.querySelector('tr[data-md-table-row="900"]')).not.toBeNull();
    expect(controller.getMountedRowCount()).toBeLessThan(50);

    controller.dispose();
    expect(disposedRows.length).toBeGreaterThan(0);
  });

  it("routes an oversized Markdown table through the windowed widget adapter", () => {
    const source = [
      "| Name | Value |",
      "| --- | ---: |",
      ...Array.from({ length: 240 }, (_, index) => `| row ${index} | ${index} |`),
    ].join("\n");
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          markdownLivePreviewExtension("safe", null, "oversized-table.md"),
        ],
      }),
    });
    views.push(view);

    const wrapper = view.dom.querySelector<HTMLElement>(
      '.cm-md-table-widget-wrap[data-md-table-execution="windowed"]',
    );
    const table = wrapper?.querySelector<HTMLTableElement>("table");
    const mountedRows = wrapper?.querySelectorAll("tbody tr[data-md-table-body-index]").length ?? 0;

    expect(wrapper).not.toBeNull();
    expect(table?.getAttribute("aria-rowcount")).toBe("241");
    expect(table?.getAttribute("aria-colcount")).toBe("2");
    expect(mountedRows).toBeGreaterThan(0);
    expect(mountedRows).toBeLessThan(50);
  });

  it("bounds the semantic row model before a pathological table reaches a widget", () => {
    const source = [
      "| Name | Value |",
      "| --- | --- |",
      ...Array.from(
        { length: MARKDOWN_TABLE_MODEL_ROW_LIMIT + 2 },
        (_, index) => `| row ${index} | ${index} |`,
      ),
    ].join("\n");
    const table = getMarkdownTableBlock(
      EditorState.create({ doc: source }),
      1,
      { from: 0, to: source.length },
    );

    expect(table).not.toBeNull();
    expect(table?.modelComplete).toBe(false);
    expect(table?.rowCount).toBe(MARKDOWN_TABLE_MODEL_ROW_LIMIT + 3);
    expect(table?.rows).toHaveLength(1);
    expect(table?.to).toBe(source.length);
  });

  it("caps ultra-wide rows before collecting discarded cell arrays", () => {
    const columns = Array.from(
      { length: MARKDOWN_TABLE_MODEL_COLUMN_LIMIT + 2 },
      (_, index) => `column-${index}`,
    );
    const source = [
      `| ${columns.join(" | ")} |`,
      `| ${columns.map(() => "---").join(" | ")} |`,
      `| ${columns.join(" | ")} |`,
    ].join("\n");

    const table = getMarkdownTableBlock(
      EditorState.create({ doc: source }),
      1,
      { from: 0, to: source.length },
    );

    expect(table?.modelComplete).toBe(false);
    expect(table?.rows).toHaveLength(1);
    expect(table?.rows[0]?.cells.length).toBeLessThanOrEqual(MARKDOWN_TABLE_MODEL_COLUMN_LIMIT);
    expect(table?.cellCount).toBe(MARKDOWN_TABLE_MODEL_COLUMN_LIMIT + 1);
  });

  it("drops the semantic row model when one row or the total source budget is exceeded", () => {
    const oversizedRowSource = [
      "| Name | Value |",
      "| --- | --- |",
      `| ${"x".repeat(MARKDOWN_TABLE_MODEL_ROW_BYTE_LIMIT)} | value |`,
    ].join("\n");
    const oversizedRow = getMarkdownTableBlock(
      EditorState.create({ doc: oversizedRowSource }),
      1,
      { from: 0, to: oversizedRowSource.length },
    );
    expect(oversizedRow?.modelComplete).toBe(false);
    expect(oversizedRow?.rows).toHaveLength(1);

    const boundedRow = `| ${"x".repeat(63 * 1024)} | value |`;
    const oversizedTotalSource = [
      "| Name | Value |",
      "| --- | --- |",
      ...Array.from({ length: 66 }, () => boundedRow),
    ].join("\n");
    const oversizedTotal = getMarkdownTableBlock(
      EditorState.create({ doc: oversizedTotalSource }),
      1,
      { from: 0, to: oversizedTotalSource.length },
    );
    expect(oversizedTotal?.modelComplete).toBe(false);
    expect(oversizedTotal?.rows).toHaveLength(1);
    expect(oversizedTotal?.sourceBytes).toBe(MARKDOWN_TABLE_MODEL_SOURCE_BYTE_LIMIT + 1);
  });
});

describe("Markdown compound HTML media", () => {
  it("keeps unresolved media inert so each asset can hydrate independently", () => {
    const result = createSanitizedBlockHtmlFragment(
      '<figure><img src="images/large.png" srcset="images/small.png 1x, images/large.png 2x" width="640" height="360"></figure>',
      { deferredMedia: true },
    );

    expect(result.supported).toBe(true);
    const image = result.fragment.querySelector("img");
    expect(image?.hasAttribute("src")).toBe(false);
    expect(image?.hasAttribute("srcset")).toBe(false);
    expect(image?.dataset.mdAssetSrc).toBe("images/large.png");
    expect(image?.dataset.mdAssetSrcset).toContain("images/small.png 1x");
    expect(image?.getAttribute("aria-busy")).toBe("true");
  });

  it("rejects an over-broad srcset before starting broker work", async () => {
    const resolver = vi.fn(async () => "blob:https://puppyone.local/asset");
    const sourceSet = Array.from({ length: 17 }, (_, index) => `image-${index}.png ${index + 1}x`).join(", ");

    await expect(resolveMarkdownImageSrcset(sourceSet, "note.md", resolver)).resolves.toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("defers a soft-over-budget HTML subtree until explicit activation", () => {
    const source = [
      "<div>",
      ...Array.from({ length: 450 }, (_, index) => `<p>paragraph ${index}</p>`),
      "</div>",
    ].join("\n");
    const view = createLivePreviewView(source, "large-html.md");

    const placeholder = view.dom.querySelector<HTMLElement>(".cm-md-html-deferred");
    expect(placeholder?.textContent).toContain("Large HTML preview is paused");
    expect(view.dom.querySelectorAll(".cm-md-html-rendered-surface p")).toHaveLength(0);

    placeholder?.querySelector<HTMLButtonElement>("button")?.click();

    expect(view.dom.querySelectorAll(".cm-md-html-rendered-surface p")).toHaveLength(450);
  });

  it("defers a large Mermaid computation and keeps a long code fence as source", () => {
    const mermaidSource = [
      "```mermaid",
      "graph TD",
      ...Array.from({ length: 1_050 }, (_, index) => `A${index} --> A${index + 1}`),
      "```",
    ].join("\n");
    const mermaidView = createLivePreviewView(mermaidSource, "large-diagram.md");
    expect(mermaidView.dom.querySelector(".cm-md-mermaid-deferred")).not.toBeNull();
    expect(mermaidView.dom.querySelector(".cm-md-mermaid-svg-root")).toBeNull();

    const codeSource = [
      "```text",
      ...Array.from({ length: 513 }, (_, index) => `line ${index}`),
      "```",
    ].join("\n");
    const codeView = createLivePreviewView(codeSource, "large-code.md");
    expect(codeView.dom.querySelector(".cm-md-code-widget")).toBeNull();
    expect(codeView.state.doc.toString()).toBe(codeSource);
  });
});

function createLivePreviewView(source: string, documentPath: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        ...markdownCodeMirrorBaseExtensions(false),
        markdownLivePreviewExtension("safe", null, documentPath),
      ],
    }),
  });
  views.push(view);
  return view;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}
