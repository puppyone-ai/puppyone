/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DataNode, ExplorerTreeProps } from "@puppyone/shared-ui";
import { useResourceDragExport } from "../src/features/data-workspace/useResourceDragExport";
import type { ResolvedWorkbenchDataResource } from "../src/features/data-workspace/workbenchDataPort";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { delete window.puppyoneDesktop; });
it("keeps ordinary drag in HTML and starts native export only for the explicit modifier", async () => {
  const root = createRoot(document.createElement("div"));
  const failure = vi.fn();
  const startResourceDrag = vi.fn(async () => true);
  window.puppyoneDesktop = { startResourceDrag } as unknown as NonNullable<typeof window.puppyoneDesktop>;
  const node: DataNode = { id: "file", path: "puppyone-local://workspace/a/docs/file.md", name: "file.md", type: "file" };
  const resolve = () => ({ folder: { workspace: { path: "/repo" } }, providerPath: "docs/file.md" }) as ResolvedWorkbenchDataResource;
  let exportNodes!: NonNullable<ExplorerTreeProps["onExportNodes"]>;
  function Harness() { exportNodes = useResourceDragExport(resolve, failure); return null; }
  try {
    act(() => root.render(<Harness />));
    const preventDefault = vi.fn();
    const event = { dataTransfer: { setData: vi.fn() }, preventDefault, altKey: false } as unknown as React.DragEvent<HTMLElement>;
    exportNodes([node], event);
    expect(startResourceDrag).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    exportNodes([node], { ...event, altKey: true });
    await Promise.resolve();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(startResourceDrag).toHaveBeenCalledWith({ resources: [node.path] });
    startResourceDrag.mockRejectedValueOnce(new Error("Detached root"));
    exportNodes([node], { ...event, altKey: true });
    await vi.waitFor(() => expect(failure).toHaveBeenLastCalledWith(true));
  } finally { act(() => root.unmount()); }
});
