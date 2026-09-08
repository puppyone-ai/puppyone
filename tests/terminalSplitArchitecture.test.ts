import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Terminal native split architecture", () => {
  it("shares only process-neutral split structure with Editor", () => {
    const splitModel = source(
      "packages/shared-ui/src/workbench/split-tree/splitTreeModel.ts",
    );
    const editorModel = source(
      "packages/shared-ui/src/editor/workbench/editorPaneLayoutModel.ts",
    );
    const terminalModel = source(
      "src/features/desktop-terminal/model/terminalSessions.ts",
    );

    expect(splitModel).toContain("moveWorkbenchSplitLeafToEdge");
    expect(splitModel).toContain("extractWorkbenchSplitLeaf");
    expect(splitModel).not.toMatch(/desktop-terminal|editorPane|Electron|node-pty|xterm|React/);
    expect(editorModel).toContain('from "../../workbench/split-tree"');
    expect(terminalModel).toContain('from "@puppyone/shared-ui"');
    expect(terminalModel).not.toMatch(/EditorPane|WorkingCopy|editor-workbench/);
  });

  it("keeps Group geometry outside Runtime and PTY ownership", () => {
    const controller = source(
      "src/features/app-shell/auxiliary-workbench/useAuxiliaryWorkbench.ts",
    );
    const model = source("src/features/desktop-terminal/model/terminalSessions.ts");
    const runtime = source("src/features/desktop-terminal/runtime/terminalRuntime.ts");
    const registry = source(
      "src/features/desktop-terminal/runtime/TerminalRuntimePool.ts",
    );
    const service = source("electron/main/terminal-service.mjs");

    expect(model).toContain("DesktopTerminalGroup");
    expect(model).toContain('type: "split-tab"');
    expect(model).toContain('type: "merge-tab"');
    expect(model).toContain('type: "move-group"');
    expect(model).toContain('type: "merge-group"');
    expect(model).not.toContain("TerminalRuntimeRegistry");
    expect(controller).toContain('type: "split-item"');
    expect(controller).toContain('type: "merge-item"');
    expect(controller).toContain('type: "move-group"');
    expect(controller).toContain('type: "merge-group"');
    expect(runtime).toContain("setPresented(presented: boolean)");
    expect(runtime).toContain("setFocused(focused: boolean)");
    expect(runtime).not.toContain("setActive(active: boolean)");
    expect(registry).toContain("private entries = new Map<string");
    expect(service).not.toMatch(/groupId|splitId|split tree/i);
  });

  it("moves Tabs between complete Group leaves without taking over file drops", () => {
    const tabMove = source(
      "src/features/app-shell/auxiliary-workbench/layout/interactions/useWorkbenchTabMoveDrag.ts",
    );
    const sessionView = source(
      "src/features/desktop-terminal/ui/TerminalSessionView.tsx",
    );
    const layout = source(
      "src/features/desktop-terminal/layout/TerminalGroupViewport.tsx",
    );
    const groupPane = source(
      "src/features/app-shell/auxiliary-workbench/layout/WorkbenchGroupPane.tsx",
    );
    const contentDropTarget = source(
      "src/features/app-shell/auxiliary-workbench/layout/interactions/workbenchContentDropTarget.ts",
    );
    const hosts = source(
      "src/features/app-shell/auxiliary-workbench/layout/usePersistentWorkbenchItemHosts.ts",
    );
    expect(tabMove).toContain("setPointerCapture");
    expect(tabMove).toContain('window.addEventListener("pointermove"');
    expect(tabMove).toContain('window.addEventListener("pointerup"');
    expect(tabMove).toContain("event.buttons & 1");
    expect(tabMove).toContain("document.elementFromPoint");
    expect(tabMove).toContain('"terminal-tab-move"');
    expect(tabMove).toContain("resolveWorkbenchContentDropTarget");
    expect(contentDropTarget).toContain("[data-terminal-content-drop-group-id]");
    expect(tabMove).toContain("resolveWorkbenchTabBarDropTarget");
    expect(tabMove).toContain("onInsertSession");
    expect(tabMove).not.toMatch(/DataTransfer|onDragStart|draggable/);
    expect(sessionView).toContain("classifyReferenceDataTransfer");
    expect(sessionView).toContain("onDragOver={handleTerminalDragOver}");
    expect(sessionView).toContain("onDrop={handleTerminalDrop}");
    expect(layout).toContain("<TerminalSessionHostSlot");
    expect(layout).toContain("<TerminalSessionHeader");
    expect(layout).toContain("<TerminalGroupPane");
    expect(groupPane).toContain("data-terminal-group-pane-id={groupId}");
    expect(hosts).toContain("document.createElement(\"div\")");
  });

  it("derives capacity from the character grid without tmux or a pane cap", () => {
    const constraints = source(
      "src/features/app-shell/auxiliary-workbench/layout/workbenchSplitConstraints.ts",
    );
    const runtime = source("src/features/desktop-terminal/runtime/terminalRuntime.ts");
    const terminalSources = [
      constraints,
      runtime,
      source("src/features/desktop-terminal/model/terminalSessions.ts"),
      source("src/features/desktop-terminal/layout/TerminalGroupViewport.tsx"),
    ].join("\n");

    expect(runtime).toContain("TERMINAL_COLUMNS_MIN = 20");
    expect(runtime).toContain("TERMINAL_ROWS_MIN = 8");
    expect(constraints).toContain("workbenchSplitNodeMinimumSize");
    expect(constraints).toContain("workbenchSplitRatioBounds");
    expect(terminalSources).not.toMatch(/MAX_(PANE|SPLIT)|paneLimit|tmux/i);
  });
});

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
