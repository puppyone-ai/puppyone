import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInterfaceStyleGraphFingerprint,
  isInterfaceStyleGraphChange,
  watchInterfaceStyleGraph,
} from "../../../../scripts/interface-style-graph-watcher.mjs";

const temporaryRoots = [];

afterEach(() => {
  vi.useRealTimers();
  for (const rootPath of temporaryRoots.splice(0)) {
    rmSync(rootPath, { force: true, recursive: true });
  }
});

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

  it("fingerprints paths and index imports without reacting to leaf style content", () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), "puppyone-style-graph-"));
    temporaryRoots.push(rootPath);
    const stylePath = path.join(rootPath, "windows-xp");
    mkdirSync(stylePath);
    writeFileSync(path.join(stylePath, "index.css"), '@import "./shell.css";\n');
    writeFileSync(path.join(stylePath, "shell.css"), ".shell { color: red; }\n");
    const initial = createInterfaceStyleGraphFingerprint(rootPath);

    writeFileSync(path.join(stylePath, "shell.css"), ".shell { color: blue; }\n");
    expect(createInterfaceStyleGraphFingerprint(rootPath)).toBe(initial);

    writeFileSync(path.join(stylePath, "index.css"), '@import "./shell.css";\n@import "./menu.css";\n');
    const withNewImport = createInterfaceStyleGraphFingerprint(rootPath);
    expect(withNewImport).not.toBe(initial);

    writeFileSync(path.join(stylePath, "menu.css"), ".menu { color: blue; }\n");
    expect(createInterfaceStyleGraphFingerprint(rootPath)).not.toBe(withNewImport);
  });

  it("routes verified CSS and asset graph changes through one recursive watcher", async () => {
    vi.useFakeTimers();
    const onGraphChange = vi.fn();
    let emitWatchEvent = null;
    const close = vi.fn();
    const createFingerprint = vi.fn()
      .mockReturnValueOnce("graph-1")
      .mockReturnValueOnce("graph-2")
      .mockReturnValueOnce("graph-3");
    const watchImplementation = vi.fn((_rootPath, _options, listener) => {
      emitWatchEvent = listener;
      return { close };
    });

    const watcher = watchInterfaceStyleGraph(
      "/interface-styles",
      onGraphChange,
      watchImplementation,
      { createFingerprint, settleDelayMs: 10 },
    );

    expect(watchImplementation).toHaveBeenCalledWith(
      "/interface-styles",
      { recursive: true },
      expect.any(Function),
    );

    emitWatchEvent("change", path.join("windows-xp", "surfaces", "document.css"));
    emitWatchEvent("rename", path.join("windows-xp", "surfaces", "editable-table.css"));
    await vi.runAllTimersAsync();
    emitWatchEvent("rename", path.join("windows-xp", "assets", "explorer-file-markdown.svg"));
    await vi.runAllTimersAsync();

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

  it("ignores noisy Windows file events when the import graph is unchanged", async () => {
    vi.useFakeTimers();
    const onGraphChange = vi.fn();
    let emitWatchEvent = null;
    const watchImplementation = vi.fn((_rootPath, _options, listener) => {
      emitWatchEvent = listener;
      return { close: vi.fn() };
    });
    const createFingerprint = vi.fn(() => "stable-graph");

    const watcher = watchInterfaceStyleGraph(
      "C:\\interface-styles",
      onGraphChange,
      watchImplementation,
      { createFingerprint, settleDelayMs: 10 },
    );
    emitWatchEvent("change", path.join("windows-xp", "index.css"));
    emitWatchEvent("rename", path.join("windows-xp", "index.css"));
    await vi.runAllTimersAsync();

    expect(createFingerprint).toHaveBeenCalledTimes(2);
    expect(onGraphChange).not.toHaveBeenCalled();
    watcher.close();
  });
});
