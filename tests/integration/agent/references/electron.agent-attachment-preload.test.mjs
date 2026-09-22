import { File } from "node:buffer";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const projectContext = Object.freeze({ projectId: "project", rootPath: "/workspace", generation: "opened-project" });
const context = { rootPath: "/workspace", epoch: "draft", projectContext };

describe("Agent attachment preload acquisition", () => {
  it("stages a pathless clipboard image as bytes instead of rejecting a missing path", async () => {
    const image = new File([png], "clipboard.png", { type: "image/png" });
    const invoke = vi.fn(async () => [{ id: "image", status: "ready" }]);
    const bridge = await loadBridge(invoke, () => "");

    await expect(bridge.stageAgentAttachments({ ...context, files: [image] }))
      .resolves.toEqual([{ id: "image", status: "ready" }]);
    expect(invoke).toHaveBeenCalledWith("agent:reference-stage", {
      ...context,
      sources: [{ name: "clipboard.png", bytes: png }],
    });
  });

  it("keeps the native path route and never reads an OS file into renderer memory", async () => {
    const image = new File([png], "native.png", { type: "image/png" });
    const read = vi.spyOn(image, "arrayBuffer");
    const invoke = vi.fn(async () => []);
    const bridge = await loadBridge(invoke, () => "/selected/native.png");
    await bridge.stageAgentAttachments({ ...context, files: [image] });
    expect(invoke).toHaveBeenCalledWith("agent:reference-stage", {
      ...context, sourcePaths: ["/selected/native.png"],
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("preserves source order when native and virtual files are mixed", async () => {
    const native = new File(["native"], "native.txt");
    const virtual = new File([png], "clipboard.png", { type: "image/png" });
    const invoke = vi.fn(async () => []);
    const bridge = await loadBridge(invoke, (file) => file === native ? "/selected/native.txt" : "");
    await bridge.stageAgentAttachments({ ...context, files: [virtual, native] });
    expect(invoke.mock.calls[0][1].sources).toEqual([
      { name: "clipboard.png", bytes: png }, { path: "/selected/native.txt" },
    ]);
    expect(invoke.mock.calls[0][1].projectContext).toEqual(projectContext);
  });

  it("bounds pathless bytes before reading them and rejects non-File inputs", async () => {
    const image = new File([png], "large.png", { type: "image/png" });
    Object.defineProperty(image, "size", { value: 25 * 1024 * 1024 + 1 });
    const read = vi.spyOn(image, "arrayBuffer");
    const invoke = vi.fn(async () => []);
    const bridge = await loadBridge(invoke, (file) => {
      if (!(file instanceof File)) throw new TypeError("Expected a File");
      return "";
    });
    await expect(bridge.stageAgentAttachments({ ...context, files: [image] }))
      .rejects.toThrow(/25 MB/i);
    await expect(bridge.stageAgentAttachments({ ...context, files: [{ path: "/secret" }] }))
      .rejects.toThrow(/File/i);
    expect(read).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shares the in-flight byte budget across calls and releases it after a read failure", async () => {
    const large = new File([new Uint8Array(25 * 1024 * 1024)], "large.png");
    const small = new File([png], "small.png");
    let rejectRead;
    vi.spyOn(large, "arrayBuffer").mockImplementation(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
    const invoke = vi.fn(async () => []);
    const bridge = await loadBridge(invoke, () => "");
    const request = context;
    const pending = bridge.stageAgentAttachments({ ...request, files: [large] });
    await expect(bridge.stageAgentAttachments({ ...request, files: [small] })).rejects.toThrow(/in-flight/i);
    rejectRead(new Error("File read failed"));
    await expect(pending).rejects.toThrow(/File read failed/);
    await expect(bridge.stageAgentAttachments({ ...request, files: [small] })).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledOnce();
  });
});

async function loadBridge(invoke, getPathForFile) {
  const source = await readFile(new URL("../../../../electron/preload.cjs", import.meta.url), "utf8");
  let bridge;
  vm.runInNewContext(source, {
    process: { argv: ["electron", "app"] },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { invoke, on() {}, send() {}, removeListener() {} },
      webUtils: { getPathForFile },
    }),
    Uint8Array,
  }, { filename: "preload.cjs" });
  return bridge;
}
