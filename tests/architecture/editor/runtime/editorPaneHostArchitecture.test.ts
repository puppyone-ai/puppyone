import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const splitViewSource = read(
  "../../../../src/features/editor-workbench/layout/DesktopEditorSplitView.tsx",
);
const hostRegistrySource = read(
  "../../../../src/features/editor-workbench/layout/pane-host/usePersistentEditorPaneHosts.ts",
);
const hostSlotSource = read(
  "../../../../src/features/editor-workbench/layout/pane-host/EditorPaneHostSlot.tsx",
);

describe("persistent editor pane host architecture", () => {
  it("keeps pane runtimes outside the recursive split-tree ownership boundary", () => {
    expect(splitViewSource).toContain("createPortal(");
    expect(splitViewSource).toContain("panes.map((pane) => createPortal(");
    expect(splitViewSource).toContain("<EditorPaneHostSlot");
    expect(splitViewSource).not.toContain(
      'if (props.node.kind === "pane") return <EditorPane',
    );
  });

  it("owns one stable host per semantic pane and reattaches it before paint", () => {
    expect(hostRegistrySource).toContain("hosts.has(paneId)");
    expect(hostRegistrySource).toContain("document.createElement(\"div\")");
    expect(hostRegistrySource).toContain("hosts.set(paneId, host)");
    expect(hostSlotSource).toContain("useLayoutEffect");
    expect(hostSlotSource).toContain("slot.append(host)");
  });
});

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
