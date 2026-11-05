/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorPaneLayoutLeaf } from "@puppyone/shared-ui";
import { EditorPaneShell } from "../../../../../src/features/editor-workbench/layout/EditorPaneShell";
import type { EditorFileDropController } from "../../../../../src/features/editor-workbench/drag-and-drop/useExplorerFileDrop";
import type { PaneMoveDragController } from "../../../../src/features/editor-workbench/drag-and-drop/usePaneMoveDrag";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const pane: EditorPaneLayoutLeaf = {
  id: "pane-1",
  kind: "pane",
  editorId: "editor-1",
  size: 1,
};

const paneMove: PaneMoveDragController = {
  dragging: false,
  dropIntent: null,
  prepare: vi.fn(),
  start: vi.fn(),
  move: vi.fn(),
  end: vi.fn(() => ({ kind: "cancelled" as const })),
  cancel: vi.fn(),
  lostCapture: vi.fn(),
};

function dropController(overrides: Partial<EditorFileDropController> = {}): EditorFileDropController {
  return {
    dropIntent: null,
    dropFailed: false,
    insertIntent: false,
    dismissDropFailure: vi.fn(),
    over: vi.fn(),
    leave: vi.fn(),
    drop: vi.fn(),
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(fileDrop: EditorFileDropController) {
  await act(async () => root.render(withTestLocalization(
    <EditorPaneShell
      active
      actionsOpen={false}
      agentPresencePath={null}
      contentState="document"
      editorLabel="notes/a.md"
      fileDrop={fileDrop}
      findCommand={null}
      menuContribution={null}
      pane={pane}
      paneCount={1}
      paneMove={paneMove}
      onActionsPaneChange={() => {}}
      onActivate={() => {}}
      onClose={() => {}}
      onOpenExternal={null}
      onSplit={() => {}}
    >
      <div data-testid="pane-content" />
    </EditorPaneShell>,
  )));
  return host.querySelector<HTMLElement>(".desktop-editor-pane")!;
}

describe("editor pane insert affordance", () => {
  it("marks the pane as an insert target and hides the split preview", async () => {
    const shell = await render(dropController({ insertIntent: true }));
    expect(shell.getAttribute("data-drop-kind")).toBe("insert");
    expect(shell.querySelector(".desktop-editor-drop-preview")).toBeNull();
  });

  it("keeps the split preview when the drop would split the pane", async () => {
    const shell = await render(dropController({
      insertIntent: false,
      dropIntent: { targetPaneId: pane.id, edge: "left" },
    }));
    expect(shell.getAttribute("data-drop-kind")).toBe("file");
    expect(shell.getAttribute("data-drop-target")).toBe("left");
    expect(shell.querySelector(".desktop-editor-drop-preview")).not.toBeNull();
  });
});
