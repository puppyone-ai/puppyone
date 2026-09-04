import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorSurfaceSessionManager } from "../electron/main/editor-surfaces/session-manager.mjs";

const createdViews = [];
let nextWebContentsId = 100;
let loadUrlBehavior = null;
let pdfViewerFrameAvailable = true;

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.id = nextWebContentsId++;
    this.destroyed = false;
    this.sent = [];
    this.mainFrame = {
      get frames() {
        return pdfViewerFrameAvailable
          ? [{ url: "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html", frames: [] }]
          : [];
      },
    };
  }

  async loadURL(url) {
    this.url = url;
    return loadUrlBehavior?.(url);
  }
  send(channel, payload) { this.sent.push([channel, payload]); }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  setAudioMuted(muted) { this.audioMuted = muted; }
  getOSProcessId() { return this.id + 1_000; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; }
  forcefullyCrashRenderer() { this.emit("render-process-gone", {}, { reason: "killed", exitCode: 137 }); }
}

class FakeWebContentsView {
  constructor(options) {
    this.options = options;
    this.webContents = new FakeWebContents();
    this.visible = true;
    this.bounds = null;
    this.backgroundColor = null;
    createdViews.push(this);
  }

  setBackgroundColor(color) { this.backgroundColor = color; }
  setBounds(bounds) { this.bounds = bounds; }
  getBounds() { return this.bounds; }
  setVisible(visible) { this.visible = visible; }
}

class FakeOwnerWindow extends EventEmitter {
  constructor(id) {
    super();
    this.destroyed = false;
    this.children = [];
    this.webContents = new EventEmitter();
    this.webContents.id = id;
    this.webContents.sent = [];
    this.webContents.destroyed = false;
    this.webContents.session = { ownerWebContentsId: id };
    this.webContents.isDestroyed = () => this.webContents.destroyed;
    this.webContents.send = (channel, payload) => this.webContents.sent.push([channel, payload]);
    this.contentView = {
      addChildView: (view) => this.children.push(view),
      removeChildView: (view) => {
        const index = this.children.indexOf(view);
        if (index >= 0) this.children.splice(index, 1);
      },
    };
  }

  getContentSize() { return [1_200, 800]; }
  isDestroyed() { return this.destroyed; }
}

function request(ownerWebContentsId = 7) {
  return {
    ownerWebContentsId,
    viewerId: "pdf-preview",
    documentPath: "reports/large.pdf",
    documentRevision: "revision:1",
    resourceUrl: "puppyone-local://file/token/file-preview/reports/large.pdf",
    title: "large.pdf",
    safeMode: true,
    bounds: { x: 20, y: 30, width: 800, height: 600 },
    geometryRevision: 1,
    visible: true,
    appearance: { dark: true, direction: "ltr", attributes: {}, variables: {} },
  };
}

function createHarness(owner, options = {}) {
  const browserSession = { partition: "persist:puppyone-pdf-viewer" };
  const admitResource = vi.fn(async () => ({
    byteLength: 20,
    navigationUrl: "file:///workspace/reports/large.pdf",
  }));
  const manager = createEditorSurfaceSessionManager({
    WebContentsView: FakeWebContentsView,
    browserSession,
    getOwnerWindow: (id) => id === owner.webContents.id ? owner : null,
    admitResource,
    ...options,
  });
  return { manager, admitResource, browserSession };
}

describe("browser-engine Editor Surface fault domain", () => {
  beforeEach(() => {
    createdViews.length = 0;
    nextWebContentsId = 100;
    loadUrlBehavior = null;
    pdfViewerFrameAvailable = true;
  });

  it("loads an admitted PDF directly in Chromium's sandboxed native viewer", async () => {
    const owner = new FakeOwnerWindow(7);
    const { manager, browserSession } = createHarness(owner);
    const session = await manager.activate(request());
    const view = createdViews[0];

    expect(view.options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      plugins: true,
      session: browserSession,
    });
    expect(view.options.webPreferences).not.toHaveProperty("preload");
    expect(view.options.webPreferences).not.toHaveProperty("partition");
    expect(view.options.webPreferences.session).not.toBe(owner.webContents.session);
    expect(view.webContents.url).toBe(
      "file:///workspace/reports/large.pdf#toolbar=0&navpanes=0",
    );
    expect(view.webContents.sent).toEqual([]);
    expect(view.backgroundColor).toBe("#202124");
    expect(session).toMatchObject({ status: "ready", safeMode: false });
    expect(manager.values()[0].resourcePolicy).toEqual(expect.objectContaining({
      maxSourceBytes: 536_870_912,
      maxCanvasPixels: 0,
      maxActiveCanvases: 0,
      maxWorkers: 0,
    }));
    expect(owner.webContents.sent.at(-1)).toEqual([
      "editor-surface:state",
      expect.objectContaining({ sessionId: session.sessionId, status: "ready" }),
    ]);
  });

  it("preserves admitted PDF open parameters while forcing browser chrome off", async () => {
    const owner = new FakeOwnerWindow(7);
    const { manager } = createHarness(owner, {
      admitResource: vi.fn(async () => ({
        byteLength: 20,
        navigationUrl: "https://example.com/report.pdf#page=3&zoom=125",
      })),
    });

    await manager.activate(request());

    expect(createdViews[0].webContents.url).toBe(
      "https://example.com/report.pdf#page=3&zoom=125&toolbar=0&navpanes=0",
    );
  });

  it("bounds native PDF navigation before allocating a long-lived surface", async () => {
    vi.useFakeTimers();
    try {
      loadUrlBehavior = () => new Promise(() => {});
      const owner = new FakeOwnerWindow(7);
      const { manager } = createHarness(owner, { navigationTimeoutMs: 10 });
      const activation = manager.activate(request());
      const rejection = expect(activation).rejects.toThrow(/navigation timed out/i);

      await vi.advanceTimersByTimeAsync(11);
      await rejection;

      expect(manager.values()).toEqual([]);
      expect(owner.webContents.sent).toContainEqual([
        "editor-surface:state",
        expect.objectContaining({ status: "error", reason: "navigation-timeout" }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not report ready when Chromium's PDF Viewer frame never attaches", async () => {
    vi.useFakeTimers();
    try {
      pdfViewerFrameAvailable = false;
      const owner = new FakeOwnerWindow(7);
      const { manager } = createHarness(owner, { viewerAttachTimeoutMs: 10 });
      const activation = manager.activate(request());
      const rejection = expect(activation).rejects.toThrow(/did not attach/i);

      await vi.advanceTimersByTimeAsync(60);
      await rejection;

      expect(manager.values()).toEqual([]);
      expect(owner.webContents.sent).toContainEqual([
        "editor-surface:state",
        expect.objectContaining({ status: "error", reason: "viewer-attach-timeout" }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("contains an out-of-memory crash to one native PDF Surface", async () => {
    const owner = new FakeOwnerWindow(7);
    const { manager } = createHarness(owner);
    const first = await manager.activate(request());
    const second = await manager.activate({ ...request(), documentPath: "reports/sibling.pdf" });

    createdViews[0].webContents.emit(
      "render-process-gone",
      {},
      { reason: "oom", exitCode: 137 },
    );

    expect(owner.destroyed).toBe(false);
    expect(manager.values().map(({ sessionId }) => sessionId)).toEqual([second.sessionId]);
    expect(owner.children).toEqual([createdViews[1]]);
    expect(owner.webContents.sent).toContainEqual([
      "editor-surface:state",
      expect.objectContaining({ sessionId: first.sessionId, status: "crashed", reason: "oom" }),
    ]);
  });

  it("restores a ready surface after a transient unresponsive event", async () => {
    const owner = new FakeOwnerWindow(7);
    const { manager } = createHarness(owner);
    const session = await manager.activate(request());
    const view = createdViews[0];

    view.webContents.emit("unresponsive");
    expect(view.visible).toBe(false);

    view.webContents.emit("responsive");
    expect(view.visible).toBe(true);
    expect(owner.webContents.sent.at(-1)).toEqual([
      "editor-surface:state",
      expect.objectContaining({ sessionId: session.sessionId, status: "ready" }),
    ]);
  });

  it("applies only monotonic geometry and suspends the native child during shell layout", async () => {
    const owner = new FakeOwnerWindow(7);
    const { manager } = createHarness(owner);
    const session = await manager.activate(request());
    const view = createdViews[0];

    expect(manager.setBounds(
      session.sessionId,
      { x: 20, y: 30, width: 620, height: 600 },
      owner.webContents.id,
      2,
      false,
    )).toEqual({ ok: true, applied: true, geometryRevision: 2 });
    expect(view.bounds).toEqual({ x: 20, y: 30, width: 620, height: 600 });
    expect(view.visible).toBe(false);

    expect(manager.setBounds(
      session.sessionId,
      { x: 20, y: 30, width: 900, height: 600 },
      owner.webContents.id,
      1,
      true,
    )).toEqual({ ok: true, applied: false, geometryRevision: 2 });
    expect(view.bounds.width).toBe(620);
    expect(view.visible).toBe(false);

    expect(manager.setBounds(
      session.sessionId,
      { x: 20, y: 30, width: 600, height: 600 },
      owner.webContents.id,
      3,
      true,
    )).toEqual({ ok: true, applied: true, geometryRevision: 3 });
    expect(view.bounds.width).toBe(600);
    expect(view.visible).toBe(true);
  });

  it("rejects non-browser-engine Viewers and direct renderer-supplied file URLs", async () => {
    const owner = new FakeOwnerWindow(7);
    const { manager } = createHarness(owner);

    await expect(manager.activate({ ...request(), viewerId: "markdown" }))
      .rejects.toThrow(/browser-engine/i);
    await expect(manager.activate({ ...request(), resourceUrl: "file:///tmp/private.pdf" }))
      .rejects.toThrow(/not allowed/i);
    expect(createdViews).toHaveLength(0);
  });

  it("rejects a non-file navigation target returned by resource admission", async () => {
    const owner = new FakeOwnerWindow(7);
    const { manager } = createHarness(owner, {
      admitResource: vi.fn(async () => ({
        byteLength: 20,
        navigationUrl: "javascript:alert(1)",
      })),
    });

    await expect(manager.activate(request())).rejects.toThrow(/not allowed/i);
    expect(createdViews).toHaveLength(0);
  });

  it("runs authoritative resource admission before allocating a child view", async () => {
    const owner = new FakeOwnerWindow(7);
    const admitResource = vi.fn(async () => {
      throw new Error("source budget exceeded");
    });
    const { manager } = createHarness(owner, { admitResource });

    await expect(manager.activate(request())).rejects.toThrow("source budget exceeded");
    expect(admitResource).toHaveBeenCalledWith(expect.objectContaining({
      ownerWebContentsId: 7,
      resourceUrl: request().resourceUrl,
      resourcePolicy: expect.objectContaining({ maxSourceBytes: 536_870_912 }),
    }));
    expect(createdViews).toHaveLength(0);
  });
});
