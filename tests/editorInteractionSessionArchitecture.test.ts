import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fileDropSource = read("../src/features/editor-workbench/drag-and-drop/useExplorerFileDrop.ts");
const paneMoveSource = read("../src/features/editor-workbench/drag-and-drop/usePaneMoveDrag.ts");
const resizeSource = read("../src/features/editor-workbench/interactions/useSplitResizeGesture.ts");
const editorTerminationAdapterSource = read(
  "../src/features/editor-workbench/interactions/useInteractionTermination.ts",
);
const terminationSource = read(
  "../src/features/workbench-interactions/useInteractionTermination.ts",
);
const nativeLeaseSource = read(
  "../src/features/native-surfaces/nativeSurfacePointerPassthrough.ts",
);

describe("editor interaction session architecture", () => {
  it("owns native passthrough through idempotent session leases", () => {
    expect(nativeLeaseSource).toContain("activeLeases = new Map");
    expect(nativeLeaseSource).toContain("if (released) return");
    expect(nativeLeaseSource).toContain("activeLeases.delete(leaseId)");
    expect(fileDropSource).toContain('"explorer-file-drop", id');
    expect(paneMoveSource).toContain('"editor-pane-move",');
    expect(resizeSource).toContain('"editor-split-resize", id');
    expect(fileDropSource).not.toContain("setNativeSurfacePointerPassthrough(");
    expect(paneMoveSource).not.toContain("setNativeSurfacePointerPassthrough(");
    expect(resizeSource).not.toContain("setNativeSurfacePointerPassthrough(");
  });

  it("funnels renderer terminal events through one lifecycle boundary", () => {
    expect(terminationSource).toContain('window.addEventListener("blur"');
    expect(terminationSource).toContain('window.addEventListener("pagehide"');
    expect(terminationSource).toContain('document.addEventListener("visibilitychange"');
    expect(terminationSource).toContain('window.addEventListener("drop", handleDrop)');
    expect(terminationSource).not.toContain(
      'window.addEventListener("drop", handleDrop, true)',
    );
    expect(terminationSource).toContain('terminate("unmount")');
    expect(editorTerminationAdapterSource).toContain(
      'from "../../workbench-interactions/useInteractionTermination"',
    );
    expect(fileDropSource).toContain("useInteractionTermination");
    expect(paneMoveSource).toContain("useInteractionTermination");
    expect(resizeSource).toContain("useInteractionTermination");
  });
});

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
