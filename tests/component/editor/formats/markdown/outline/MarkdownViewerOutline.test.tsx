/**
 * @vitest-environment happy-dom
 */
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTestLocalization } from "../../../../../support/react/localization";

const hoisted = vi.hoisted(() => {
  const view = { scrollDOM: {}, state: {} };
  return { view, scroll: vi.fn() };
});

vi.mock("../../../../../../src/shared-ui/editor/markdown/core/interaction/markdownHeadingOutline", async (original) => {
  const module = await original<typeof import("../../../../../../src/shared-ui/editor/markdown/core/interaction/markdownHeadingOutline")>();
  return { ...module, scrollMarkdownViewToHeading: hoisted.scroll };
});

const editorProps: Array<Record<string, unknown>> = [];

vi.mock("../../../../../../src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor", () => ({
  MarkdownCodeMirrorEditor: (props: Record<string, unknown> & {
    livePreview?: boolean;
    onOutlineChange?: (snapshot: unknown) => void;
    onViewReady?: (view: unknown) => void;
  }) => {
    editorProps.push(props);
    const { onOutlineChange, onViewReady } = props;
    useEffect(() => {
      onViewReady?.(hoisted.view);
      onOutlineChange?.({
        headings: [
          { from: 0, level: 1, title: "A", plainTitle: "A" },
          { from: 10, level: 2, title: "B", plainTitle: "B" },
        ],
        activeIndex: 0,
      });
      return () => onViewReady?.(null);
    }, [onOutlineChange, onViewReady]);
    return <div data-testid="fake-editor" data-live={String(props.livePreview)} />;
  },
}));

import { MarkdownViewer } from "../../../../../../src/shared-ui/editor/markdown/MarkdownViewer";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  editorProps.length = 0;
  hoisted.scroll.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function context(overrides: Record<string, unknown> = {}) {
  return {
    document: { path: "notes/a.md", name: "a.md", type: "file" },
    content: "# A\n\n## B\n",
    canEdit: true,
    hideSourceView: false,
    editorInteractionPreferences: {
      markdownBlockDragEnabled: false,
      markdownHeadingOutlineEnabled: false,
    },
    aiEditFile: null,
    htmlTrustMode: "safe" as const,
    workspaceId: "w1",
    workspaceRoot: "/workspace",
    markdownEnvironment: undefined,
    ...overrides,
  };
}

describe("MarkdownViewer outline panel", () => {
  it("renders the outline beside the editor and jumps without the rail preference", async () => {
    await act(async () => root.render(withTestLocalization(
      <MarkdownViewer {...context()} />,
    )));

    const panel = host.querySelector("nav.po-markdown-outline-panel");
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("aria-label")).toBe("Document outline");
    const items = [...host.querySelectorAll<HTMLButtonElement>(".po-markdown-outline-item")];
    expect(items.map((item) => item.textContent)).toEqual(["A", "B"]);
    expect(host.querySelector(".markdown-viewer-shell > .editor-host")).not.toBeNull();

    await act(async () => items[1]!.click());
    expect(hoisted.scroll).toHaveBeenCalledTimes(1);
    expect(hoisted.scroll.mock.calls[0]![0]).toBe(hoisted.view);
    expect((hoisted.scroll.mock.calls[0]![1] as { title: string }).title).toBe("B");
  });

  it("publishes an outline from source mode as well", async () => {
    await act(async () => root.render(withTestLocalization(
      <MarkdownViewer {...context()} />,
    )));
    // The live editor is mounted first; switch the frame to source mode.
    const sourceButton = [...host.querySelectorAll<HTMLButtonElement>(".editor-mode-toggle button")]
      .at(-1);
    await act(async () => sourceButton?.click());
    const sourceProps = editorProps.filter((props) => props.livePreview === false);
    expect(sourceProps).toHaveLength(1);
    expect(typeof sourceProps[0]!.onOutlineChange).toBe("function");
  });
});
