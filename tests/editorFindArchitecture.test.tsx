/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CsvTableEditor } from "../packages/shared-ui/src/editor/viewers/csv/CsvTableEditor";
import { CodeMirrorFindAdapter } from "../packages/shared-ui/src/editor/find/codeMirrorFindAdapter";
import { MarkdownCodeMirrorEditor } from "../packages/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor";
import {
  EditorFindContributionProvider,
  EditorFindHost,
  type EditorFindAdapter,
  useEditorFindCommand,
  useRegisterEditorFindAdapter,
} from "../packages/shared-ui/src/editor/find/editorFind";
import { withTestLocalization } from "./testLocalization";

const editorFindStyles = readFileSync(
  "packages/shared-ui/src/styles/editor/editor-find.css",
  "utf8",
);

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("editor find architecture", () => {
  it("keeps the find overlay host out of the editor flex and overflow contracts", () => {
    const ruleStart = editorFindStyles.indexOf(".editor-find-host {");
    const hostRule = editorFindStyles.slice(ruleStart, editorFindStyles.indexOf("}", ruleStart) + 1);
    expect(hostRule).toContain("position: relative");
    expect(hostRule).toContain("width: 100%");
    expect(hostRule).toContain("height: 100%");
    expect(hostRule).toContain("overflow: visible");
    expect(hostRule).not.toContain("display: flex");
    expect(hostRule).not.toContain("overflow: hidden");
    expect(editorFindStyles).not.toContain(".editor-find-host > :not(.editor-find-widget)");
  });

  it("keeps the find widget compact and separates primary input from secondary controls", () => {
    const widgetRuleStart = editorFindStyles.indexOf(".editor-find-widget {");
    const widgetRule = editorFindStyles.slice(
      widgetRuleStart,
      editorFindStyles.indexOf("}", widgetRuleStart) + 1,
    );
    expect(widgetRule).toContain("width: min(304px, calc(100% - 24px))");
    expect(widgetRule).toContain("height: var(--po-control-size)");
    expect(widgetRule).toContain("var(--po-panel-raised)");
    expect(widgetRule).toContain("var(--po-border-subtle)");
    expect(widgetRule).toContain("border-radius: 8px");

    const resultRuleStart = editorFindStyles.indexOf(".editor-find-widget__result {");
    const resultRule = editorFindStyles.slice(
      resultRuleStart,
      editorFindStyles.indexOf("}", resultRuleStart) + 1,
    );
    expect(resultRule).toContain("border-inline-start: 1px solid var(--po-divider)");
    expect(resultRule).toContain("font-variant-numeric: tabular-nums");
    expect(editorFindStyles).toContain(".editor-find-widget__result:empty");

    const focusRuleStart = editorFindStyles.indexOf(".editor-find-widget:focus-within {");
    const focusRule = editorFindStyles.slice(
      focusRuleStart,
      editorFindStyles.indexOf("}", focusRuleStart) + 1,
    );
    expect(focusRule).toContain("var(--po-text-muted)");
    expect(focusRule).not.toContain("box-shadow");
    expect(focusRule).not.toContain("var(--po-accent)");
    expect(editorFindStyles).not.toContain(".editor-find-widget input:focus-visible");
  });

  it("does not let a stale adapter cleanup dismiss the active find session", async () => {
    const firstAdapter = createAdapter();
    const activeAdapter = createAdapter();
    const renderAdapters = (showFirst: boolean) => withTestLocalization(
      <EditorFindHost documentId="transitioning.md">
        {showFirst && <AdapterViewer adapter={firstAdapter} />}
        <AdapterViewer adapter={activeAdapter} />
      </EditorFindHost>,
    );

    await act(async () => root.render(renderAdapters(true)));
    const activeViewer = container.querySelectorAll<HTMLElement>("[data-test-adapter-viewer]")[1];
    await act(async () => {
      activeViewer.dispatchEvent(new KeyboardEvent("keydown", {
        key: "f",
        metaKey: true,
        bubbles: true,
      }));
    });
    const input = container.querySelector<HTMLInputElement>(".editor-find-widget input");
    await changeInput(input!, "puppy");

    await act(async () => root.render(renderAdapters(false)));
    expect(container.querySelector(".editor-find-widget input")).toBe(input);
    expect(input?.value).toBe("puppy");
    expect(activeAdapter.setQuery).toHaveBeenLastCalledWith("puppy");
  });

  it("keeps the real Markdown find widget mounted while typing and preserves its scroll owner", async () => {
    await act(async () => {
      root.render(withTestLocalization(
        <EditorFindHost documentId="long-notes.md">
          <MarkdownCodeMirrorEditor
            value={`${"first line\n".repeat(80)}needle\n${"last line\n".repeat(80)}`}
            readOnly={false}
            livePreview
            documentPath="long-notes.md"
          />
        </EditorFindHost>,
      ));
      await Promise.resolve();
    });

    const markdownEditor = container.querySelector<HTMLElement>(".markdown-codemirror-editor");
    const scroller = container.querySelector<HTMLElement>(".markdown-codemirror-editor .cm-scroller");
    expect(markdownEditor).toBeInstanceOf(HTMLElement);
    expect(scroller).toBeInstanceOf(HTMLElement);
    scroller!.scrollTop = 240;

    await act(async () => {
      markdownEditor?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "f",
        metaKey: true,
        bubbles: true,
      }));
    });
    const input = container.querySelector<HTMLInputElement>(".editor-find-widget input");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await changeInput(input!, "needle");
    expect(container.querySelector(".editor-find-widget input")).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(container.querySelector(".editor-find-widget__result")?.textContent).toBe("1 of 1");
    expect(container.querySelector(".markdown-codemirror-editor .cm-scroller")).toBe(scroller);
    scroller!.scrollTop = 480;
    scroller!.dispatchEvent(new Event("scroll"));
    expect(scroller!.scrollTop).toBe(480);
    expect(container.querySelectorAll(".markdown-codemirror-editor .cm-editor-find-match"))
      .toHaveLength(1);
  });

  it("uses the CodeMirror adapter for query matching, highlights, and wrapped navigation", () => {
    const host = document.createElement("div");
    container.appendChild(host);
    const adapter = new CodeMirrorFindAdapter();
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "Puppy one\npuppy two\ncat",
        extensions: [adapter.extension],
      }),
    });
    adapter.attach(view);

    expect(adapter.setQuery("puppy")).toEqual({ current: 1, total: 2 });
    expect(view.state.selection.main.from).toBe(0);
    expect(host.querySelectorAll(".cm-editor-find-match")).toHaveLength(2);

    expect(adapter.move("next")).toEqual({ current: 2, total: 2 });
    expect(view.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    )).toBe("puppy");
    expect(adapter.move("next")).toEqual({ current: 1, total: 2 });

    adapter.dispose();
    view.destroy();
  });

  it("publishes a pane command while keeping keyboard and widget behavior in the host", async () => {
    const adapter = createAdapter();
    await act(async () => {
      root.render(withTestLocalization(
        <EditorFindContributionProvider>
          <PaneFindButton />
          <EditorFindHost documentId="notes.md">
            <AdapterViewer adapter={adapter} />
          </EditorFindHost>
        </EditorFindContributionProvider>,
      ));
    });

    const paneButton = container.querySelector<HTMLButtonElement>("[data-test-pane-find]");
    expect(paneButton).toBeInstanceOf(HTMLButtonElement);
    expect(container.querySelector(".editor-find-widget")).toBeNull();

    await act(async () => paneButton?.click());
    const input = container.querySelector<HTMLInputElement>(".editor-find-widget input");
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(input);

    await changeInput(input!, "puppy");
    expect(adapter.setQuery).toHaveBeenLastCalledWith("puppy");
    expect(container.querySelector(".editor-find-widget__result")?.textContent).toBe("1 of 3");

    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(adapter.move).toHaveBeenCalledWith("next");

    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
      }));
    });
    expect(adapter.move).toHaveBeenCalledWith("previous");

    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector(".editor-find-widget")).toBeNull();
    expect(adapter.clear).toHaveBeenCalledOnce();
    expect(adapter.focusEditor).toHaveBeenCalledOnce();
  });

  it("opens with Mod-F and navigates structured CSV cells without coupling the host to table data", async () => {
    await act(async () => {
      root.render(withTestLocalization(
        <EditorFindHost documentId="people.csv">
          <CsvTableEditor
            documentId="people.csv"
            content={"Name,Role\nAda,Engineer\nGrace,Admiral"}
            nodeName="people.csv"
          />
        </EditorFindHost>,
      ));
    });

    const editor = container.querySelector<HTMLElement>(".csv-table-editor");
    await act(async () => {
      editor?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "f",
        metaKey: true,
        bubbles: true,
      }));
    });
    const input = container.querySelector<HTMLInputElement>(".editor-find-widget input");
    await changeInput(input!, "ad");

    expect(container.querySelectorAll('[data-find-match="true"]')).toHaveLength(2);
    expect(container.querySelector('[data-find-current="true"] input')?.getAttribute("value"))
      .toBe("Ada");

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(container.querySelector('[data-find-current="true"] input')?.getAttribute("value"))
      .toBe("Admiral");
  });
});

function PaneFindButton() {
  const command = useEditorFindCommand();
  return command ? (
    <button type="button" data-test-pane-find onClick={command.open}>Find</button>
  ) : null;
}

function AdapterViewer({ adapter }: { adapter: EditorFindAdapter }) {
  useRegisterEditorFindAdapter(adapter);
  return <div data-test-adapter-viewer tabIndex={0}>Viewer</div>;
}

function createAdapter() {
  let current = 1;
  const adapter: EditorFindAdapter & {
    clear: ReturnType<typeof vi.fn>;
    focusEditor: ReturnType<typeof vi.fn>;
    move: ReturnType<typeof vi.fn>;
    setQuery: ReturnType<typeof vi.fn>;
  } = {
    setQuery: vi.fn(() => ({ current, total: 3 })),
    move: vi.fn((direction) => {
      current = direction === "next" ? current % 3 + 1 : (current + 1) % 3 + 1;
      return { current, total: 3 };
    }),
    clear: vi.fn(),
    focusEditor: vi.fn(),
  };
  return adapter;
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
