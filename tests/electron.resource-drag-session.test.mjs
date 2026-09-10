import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { createResourceDragSessionService } from "../electron/main/resource-drag-session-service.mjs";

const services = [];
afterEach(() => { for (const service of services.splice(0)) service.dispose(); vi.useRealTimers(); });
const uri = (path) => `puppyone-local://workspace/a/${path}`;
function fixture() {
  const event = (id) => ({ sender: Object.assign(new EventEmitter(), { id, isDestroyed: () => false, send: vi.fn() }) });
  const source = event(1), target = event(2);
  let marker = "", end;
  const allowed = new Set([1, 2]);
  const native = {
    start: vi.fn((_handle, _files, id, callback) => { marker = id; end = callback; return true; }),
    inspect: () => marker,
    captureGesture: () => 1,
    windowNumber: (handle) => handle,
  };
  const resolveEntries = vi.fn(async (event, request) => {
    if (!allowed.has(event.sender.id)) throw new Error("detached");
    return request.resources.map((resource) => {
      const relativePath = resource.slice(uri("").length);
      return { resourceUri: resource, absolutePath: `/repo/${relativePath}`, relativePath,
        folderId: "a", entryType: relativePath === "dest" || relativePath === "docs" ? "directory" : "file" };
    });
  });
  const service = createResourceDragSessionService({ native, resolveEntries,
    getWindow: (sender) => ({ isDestroyed: () => false, getNativeWindowHandle: () => sender.id }), settleMs: 100 });
  services.push(service);
  return { source, target, service, native, allowed, resolveEntries,
    start: () => service.start(source, { resources: [uri("docs/file.md")] }),
    end: (operation = 1, windowNumber = 2) => end({ operation, windowNumber }),
    external: () => { marker = ""; },
    claim: (intent = "agent-reference", targetResource) => service.claim(target, { paths: ["/repo/docs/file.md"], intent, targetResource }),
  };
}

it("joins a real drop to the native end, reauthorizes both windows and consumes it once", async () => {
  const f = fixture();
  await f.start();
  expect(await f.service.preview(f.target)).toMatchObject({ entries: [{ path: uri("docs/file.md") }] });
  let delivered = false;
  const result = f.claim().then((value) => { delivered = true; return value; });
  await Promise.resolve();
  expect(delivered).toBe(false);
  await expect(f.claim()).rejects.toThrow(/already/);
  f.end();
  expect(await result).toEqual({ entries: [{ path: uri("docs/file.md"), name: "file.md", entryType: "file" }] });
  expect(f.target.sender.send).toHaveBeenLastCalledWith("resource-transfer:state", { id: expect.any(String), entries: null });
  expect(f.source.sender.listenerCount("destroyed")).toBe(0);
  await expect(f.claim()).rejects.toThrow(/expired/);
});

it("accepts an IPC drop arriving just after native completion, but only in the actual target window", async () => {
  const f = fixture(); await f.start(); f.end(1, 1);
  await expect(f.claim()).rejects.toThrow(/this window/);
  await f.start(); f.end();
  expect(await f.claim()).toMatchObject({ entries: [{ path: uri("docs/file.md") }] });
});

it("admits an editor split drop without requiring a move destination", async () => {
  const f = fixture(); await f.start(); f.end();
  await expect(f.claim("editor-split")).resolves.toMatchObject({
    entries: [{ path: uri("docs/file.md"), entryType: "file" }],
  });
});

it("admits an identified editor split when Chromium omits native file objects", async () => {
  const f = fixture();
  await f.start();
  const preview = await f.service.preview(f.target);
  const claim = f.service.claim(f.target, {
    paths: [],
    intent: "editor-split",
    sessionId: preview.id,
  });
  f.end();
  await expect(claim).resolves.toMatchObject({
    entries: [{ path: uri("docs/file.md"), entryType: "file" }],
  });
});

it("rejects pathless editor split claims without the authorized preview identity", async () => {
  const f = fixture();
  await f.start();
  await expect(f.service.claim(f.target, {
    paths: [],
    intent: "editor-split",
    sessionId: f.native.inspect(),
  })).rejects.toThrow(/payload/);
  await f.service.preview(f.target);
  await expect(f.service.claim(f.target, {
    paths: [],
    intent: "editor-split",
    sessionId: "forged-session",
  })).rejects.toThrow(/payload/);
});

it("clears cancelled sessions and does not misclassify the next external file drag", async () => {
  const f = fixture(); await f.start();
  const claim = f.claim(); f.end(0);
  await expect(claim).rejects.toThrow();
  await f.start(); f.end(); f.external();
  expect(await f.claim()).toBeNull();
  expect(await f.service.preview(f.target)).toBeNull();
});

it("rejects detached roots, forged files and replay attempts", async () => {
  const f = fixture(); await f.start();
  await expect(f.service.claim(f.target, { paths: ["/repo/private.md"], intent: "agent-reference" })).rejects.toThrow(/payload/);
  const claim = f.claim(); f.allowed.delete(1); f.end();
  await expect(claim).rejects.toThrow(/detached/);
  await expect(f.claim()).rejects.toThrow(/expired/);
});

it("validates internal move destinations without treating rejected moves as external imports", async () => {
  const f = fixture(); await f.start(); f.end();
  await expect(f.claim("explorer-move", uri("docs"))).rejects.toThrow(/valid move/);
  await f.start(); f.end();
  expect(await f.claim("explorer-move", uri("dest"))).toMatchObject({ entries: [{ path: uri("docs/file.md") }] });
});

it("invalidates on source navigation and does not let an old async start replace a new drag", async () => {
  const f = fixture();
  let resolve;
  f.resolveEntries.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const starting = f.start();
  await expect(f.start()).rejects.toThrow(/already/);
  f.source.sender.emit("did-start-navigation", {}, "file:///new", false, true);
  resolve([]);
  await expect(starting).rejects.toThrow(/navigated/);
  expect(f.native.start).not.toHaveBeenCalled();
  await expect(f.start()).resolves.toBe(true);
});

it("bounds the native completion receipt and cleans failed starts", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.native.start.mockReturnValueOnce(false);
  expect(await f.start()).toBe(false);
  expect(f.source.sender.listenerCount("destroyed")).toBe(0);
  await f.start(); f.end();
  await vi.advanceTimersByTimeAsync(101);
  await expect(f.claim()).rejects.toThrow(/expired/);
  expect(f.source.sender.listenerCount("destroyed")).toBe(0);
});

it("does not start without a live source gesture and passes its captured identity through async work", async () => {
  const f = fixture();
  f.native.captureGesture = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(42);
  expect(await f.start()).toBe(false);
  expect(f.resolveEntries).not.toHaveBeenCalled();
  await f.start();
  expect(f.native.start).toHaveBeenCalledWith(1, ["/repo/docs/file.md"], expect.any(String), expect.any(Function), 42);
});

it("does not turn an in-root alias into a destructive move of its referent", async () => {
  const f = fixture();
  const original = f.resolveEntries.getMockImplementation();
  f.resolveEntries.mockImplementation((event, request) => original(event, {
    resources: request.resources.map((resource) => resource === uri("alias.md") ? uri("docs/file.md") : resource),
  }));
  await f.service.start(f.source, { resources: [uri("alias.md")] });
  f.end();
  await expect(f.claim("explorer-move", uri("dest"))).rejects.toThrow(/different path/);
});

it("rechecks the admitted path after asynchronous preparation", async () => {
  const f = fixture();
  const original = f.resolveEntries.getMockImplementation();
  f.resolveEntries.mockImplementationOnce(async (...args) => {
    const entries = await original(...args);
    f.allowed.delete(1);
    return entries;
  });
  await expect(f.start()).rejects.toThrow(/detached/);
  expect(f.native.start).not.toHaveBeenCalled();
});
