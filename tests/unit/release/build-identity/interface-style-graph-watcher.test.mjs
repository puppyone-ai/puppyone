import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  isInterfaceStyleGraphChange,
  watchInterfaceStyleGraph,
} from "../../../../scripts/interface-style-graph-watcher.mjs";

describe("interface Style graph watcher", () => {
  it("distinguishes graph mutations from ordinary style and asset content edits", () => {
    expect(isInterfaceStyleGraphChange("rename", "windows-xp/surfaces/table.css")).toBe(true);
    expect(isInterfaceStyleGraphChange("change", "windows-xp/index.css")).toBe(true);
    expect(isInterfaceStyleGraphChange("change", "windows-xp/surfaces/table.css")).toBe(false);
    expect(isInterfaceStyleGraphChange("rename", "windows-xp/assets/file.svg")).toBe(true);
    expect(isInterfaceStyleGraphChange("rename", "windows-xp/assets/file.PNG")).toBe(true);
    expect(isInterfaceStyleGraphChange("change", "windows-xp/assets/file.svg")).toBe(false);
    expect(isInterfaceStyleGraphChange("rename", "windows-xp/README.md")).toBe(false);
  });

  it("routes nested CSS and asset graph events through one recursive watcher", () => {
    const onGraphChange = vi.fn();
    let emitWatchEvent = null;
    const close = vi.fn();
    const watchImplementation = vi.fn((_rootPath, _options, listener) => {
      emitWatchEvent = listener;
      return { close };
    });

    const watcher = watchInterfaceStyleGraph(
      "/interface-styles",
      onGraphChange,
      watchImplementation,
    );

    expect(watchImplementation).toHaveBeenCalledWith(
      "/interface-styles",
      { recursive: true },
      expect.any(Function),
    );

    emitWatchEvent("change", path.join("windows-xp", "surfaces", "document.css"));
    emitWatchEvent("rename", path.join("windows-xp", "surfaces", "editable-table.css"));
    emitWatchEvent("rename", path.join("windows-xp", "assets", "explorer-file-markdown.svg"));

    expect(onGraphChange.mock.calls).toEqual([
      [{
        eventType: "rename",
        fileName: path.join("windows-xp", "surfaces", "editable-table.css"),
      }],
      [{
        eventType: "rename",
        fileName: path.join("windows-xp", "assets", "explorer-file-markdown.svg"),
      }],
    ]);

    watcher.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
