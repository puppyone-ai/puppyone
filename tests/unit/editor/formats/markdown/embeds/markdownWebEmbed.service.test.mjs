import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertMarkdownWebEmbedHref,
  assertMarkdownWebEmbedNetworkTarget,
  isPublicIpAddress,
} from "../../../../../../electron/main/markdown-web-embed-policy.mjs";
import { registerMarkdownWebEmbedIpcHandlers } from "../../../../../../electron/main/ipc/markdown-web-embed-ipc.mjs";
import { createNativeSurfaceOcclusionCoordinator } from "../../../../../../electron/main/native-surfaces/occlusion-coordinator.mjs";

const PUBLIC_ENDPOINT = { address: "93.184.216.34", family: "ipv4" };
const DEFAULT_BOUNDS = { x: 20, y: 30, width: 320, height: 180 };
const DEFAULT_CAPABILITY = Object.freeze({
  editorViewId: "md-view:test",
  workspaceId: "workspace:test",
  documentPath: "notes/test.md",
  documentRevision: "doc-revision:test",
  purpose: "web-embed",
});
const capturedHandlers = { onBeforeRequest: null, willRedirect: null, willNavigate: null };
const createdViews = [];
const createdSessions = [];
const resolvedHosts = new Map();
let loadUrlImplementation = async () => undefined;

class FakeSession extends EventEmitter {
  constructor() {
    super();
    this.webRequest = {
      onBeforeRequest: (handler) => {
        capturedHandlers.onBeforeRequest = handler;
      },
    };
    this.storageCleared = false;
    this.connectionsClosed = false;
  }

  setPermissionRequestHandler(handler) {
    this.permissionRequestHandler = handler;
  }

  setPermissionCheckHandler(handler) {
    this.permissionCheckHandler = handler;
  }

  async resolveHost(hostname) {
    const configured = resolvedHosts.get(hostname);
    if (configured instanceof Error) throw configured;
    return { endpoints: configured ?? [PUBLIC_ENDPOINT] };
  }

  async clearStorageData() {
    this.storageCleared = true;
  }

  async closeAllConnections() {
    this.connectionsClosed = true;
  }
}

class FakeWebContents extends EventEmitter {
  constructor(session) {
    super();
    this.destroyed = false;
    this.stopped = false;
    this.session = session;
    this.currentUrl = "";
    this.transientUserActivation = false;
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }

  async loadURL(href) {
    this.currentUrl = href;
    return loadUrlImplementation(href, this);
  }

  getURL() {
    return this.currentUrl;
  }

  async executeJavaScript() {
    return this.transientUserActivation;
  }

  stop() {
    this.stopped = true;
  }

  setAudioMuted(muted) {
    this.audioMuted = muted;
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("destroyed");
  }
}

class FakeWebContentsView {
  constructor(options) {
    this.webContents = new FakeWebContents(options.webPreferences.session);
    this.bounds = null;
    this.visible = true;
    this.options = options;
    createdViews.push(this);
  }

  setBounds(bounds) {
    this.bounds = bounds;
  }

  setVisible(visible) {
    this.visible = visible;
  }
}

vi.mock("electron", () => ({
  WebContentsView: FakeWebContentsView,
  session: {
    fromPartition: () => {
      const session = new FakeSession();
      createdSessions.push(session);
      return session;
    },
  },
}));

const { createMarkdownWebEmbedService } = await import("../../../../../../electron/main/markdown-web-embed-service.mjs");

class FakeOwnerWindow extends EventEmitter {
  constructor(id, width = 800, height = 600) {
    super();
    this.destroyed = false;
    this.visible = true;
    this.minimized = false;
    this.width = width;
    this.height = height;
    this.children = [];
    this.webContents = new EventEmitter();
    this.webContents.id = id;
    this.webContents.destroyed = false;
    this.webContents.isDestroyed = () => this.webContents.destroyed;
    this.contentView = {
      addChildView: (view) => this.children.push(view),
      removeChildView: (view) => {
        const index = this.children.indexOf(view);
        if (index >= 0) this.children.splice(index, 1);
      },
    };
  }

  isDestroyed() {
    return this.destroyed;
  }

  isVisible() {
    return this.visible;
  }

  isMinimized() {
    return this.minimized;
  }

  getContentBounds() {
    return { x: 0, y: 0, width: this.width, height: this.height };
  }

  close() {
    this.emit("closed");
    this.destroyed = true;
    this.webContents.destroyed = true;
  }
}

function createService(window, options = {}) {
  const externalNavigation = options.externalNavigation ?? {
    openDetached: vi.fn(() => true),
  };
  const service = createMarkdownWebEmbedService({
    externalNavigation,
    getOwnerWindow: () => window,
    ...options,
  });
  return {
    ...service,
    externalNavigation,
    create: (request) => service.create({ capability: DEFAULT_CAPABILITY, ...request }),
  };
}

async function decideRequest(url, resourceType = "image") {
  return new Promise((resolve) => {
    capturedHandlers.onBeforeRequest({ url, resourceType }, resolve);
  });
}

describe("Markdown web embed href policy", () => {
  it("allows only credential-free https embeds", () => {
    expect(assertMarkdownWebEmbedHref("https://example.com/x")).toBe("https://example.com/x");
    expect(() => assertMarkdownWebEmbedHref("file:///tmp/x.html")).toThrow(/https/i);
    expect(() => assertMarkdownWebEmbedHref("http://example.com")).toThrow(/https/i);
    expect(() => assertMarkdownWebEmbedHref("https://user:pass@example.com")).toThrow(/credentials/i);
  });

  it("rejects loopback aliases, trailing-dot localhost and IPv4-mapped IPv6", () => {
    expect(() => assertMarkdownWebEmbedHref("https://127.0.0.1:3000")).toThrow(/private|loopback/i);
    expect(() => assertMarkdownWebEmbedHref("https://[::1]/")).toThrow(/private|loopback/i);
    expect(() => assertMarkdownWebEmbedHref("https://localhost./")).toThrow(/private|loopback/i);
    expect(() => assertMarkdownWebEmbedHref("https://[::ffff:127.0.0.1]/")).toThrow(/private|loopback/i);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIpAddress("2001:db8::1")).toBe(false);
  });

  it("fails closed when DNS returns any non-public endpoint", async () => {
    const resolvePrivate = async () => ({
      endpoints: [PUBLIC_ENDPOINT, { address: "192.168.1.4", family: "ipv4" }],
    });
    await expect(
      assertMarkdownWebEmbedNetworkTarget("https://public-name.example/", resolvePrivate),
    ).rejects.toThrow(/non-public/i);
  });
});

describe("Markdown web embed service", () => {
  beforeEach(() => {
    capturedHandlers.onBeforeRequest = null;
    capturedHandlers.willRedirect = null;
    capturedHandlers.willNavigate = null;
    createdViews.length = 0;
    createdSessions.length = 0;
    resolvedHosts.clear();
    loadUrlImplementation = async () => undefined;
  });

  it("denies non-https and DNS-private subresources", async () => {
    const owner = new FakeOwnerWindow(1);
    const service = createService(owner);
    await service.create({ href: "https://example.com/", bounds: DEFAULT_BOUNDS, ownerWebContentsId: 1 });
    resolvedHosts.set("private.example", [{ address: "10.0.0.9", family: "ipv4" }]);

    expect(await decideRequest("data:image/png;base64,AAAA")).toEqual({ cancel: true });
    expect(await decideRequest("http://example.com/x")).toEqual({ cancel: true });
    expect(await decideRequest("https://127.0.0.1/x")).toEqual({ cancel: true });
    expect(await decideRequest("https://private.example/x")).toEqual({ cancel: true });
    expect(await decideRequest("https://cdn.example.com/lib.js")).toEqual({});
  });

  it("keeps fragment navigation in the embed and externalizes activated page links", async () => {
    const owner = new FakeOwnerWindow(1);
    const service = createService(owner);
    await service.create({ href: "https://example.com/start", bounds: DEFAULT_BOUNDS, ownerWebContentsId: 1 });

    const webContents = createdViews[0].webContents;
    const run = (eventName, url) => {
      let prevented = false;
      webContents.emit(eventName, { preventDefault: () => { prevented = true; } }, url);
      return prevented;
    };

    expect(run("will-navigate", "https://example.com/start#details")).toBe(false);
    webContents.transientUserActivation = true;
    expect(run("will-navigate", "https://example.com/next")).toBe(true);
    expect(run("will-navigate", "https://other.example/next")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(service.externalNavigation.openDetached).toHaveBeenNthCalledWith(
      1,
      "https://example.com/next",
    );
    expect(service.externalNavigation.openDetached).toHaveBeenNthCalledWith(
      2,
      "https://other.example/next",
    );

    webContents.transientUserActivation = false;
    expect(run("will-navigate", "https://example.com/automatic")).toBe(true);
    expect(run("will-redirect", "http://example.com/down")).toBe(true);
    expect(run("will-redirect", "https://127.0.0.1/x")).toBe(true);
    await Promise.resolve();
    expect(service.externalNavigation.openDetached).toHaveBeenCalledTimes(2);
    expect(await decideRequest("https://other.example/next", "mainFrame")).toEqual({ cancel: true });
  });

  it("cancels downloads and routes only activated popup intents to external navigation", async () => {
    const owner = new FakeOwnerWindow(1);
    const service = createService(owner);
    await service.create({ href: "https://example.com/", bounds: DEFAULT_BOUNDS, ownerWebContentsId: 1 });

    let downloadPrevented = false;
    createdSessions[0].emit("will-download", { preventDefault: () => { downloadPrevented = true; } });
    expect(downloadPrevented).toBe(true);
    const webContents = createdViews[0].webContents;
    webContents.transientUserActivation = true;
    expect(webContents.windowOpenHandler({ url: "https://example.com/docs" })).toEqual({ action: "deny" });
    await Promise.resolve();
    await Promise.resolve();
    expect(service.externalNavigation.openDetached).toHaveBeenCalledWith("https://example.com/docs");

    webContents.transientUserActivation = false;
    expect(webContents.windowOpenHandler({ url: "https://example.com/automatic" })).toEqual({ action: "deny" });
    await Promise.resolve();
    expect(service.externalNavigation.openDetached).toHaveBeenCalledTimes(1);

    let loginPrevented = false;
    createdViews[0].webContents.emit("login", { preventDefault: () => { loginPrevented = true; } });
    expect(loginPrevented).toBe(true);
    expect(createdViews[0].options.webPreferences.disableDialogs).toBe(true);
  });

  it("requires an exact live owner and rejects cross-owner operations", async () => {
    const owner = new FakeOwnerWindow(42);
    const service = createService(owner);
    const { id } = await service.create({
      href: "https://example.com/",
      bounds: DEFAULT_BOUNDS,
      ownerWebContentsId: 42,
    });

    expect(service.setBounds({ id, bounds: DEFAULT_BOUNDS, callerWebContentsId: 99 })).toEqual({ ok: false, visible: false });
    expect(service.destroy({ id, callerWebContentsId: 99 })).toEqual({ ok: false });
    expect(service.setBounds({ id, bounds: DEFAULT_BOUNDS, callerWebContentsId: 42 })).toEqual({ ok: true, visible: true });
    expect(service.destroy({ id, callerWebContentsId: 42 })).toEqual({ ok: true });

    const wrongWindowService = createService(new FakeOwnerWindow(8));
    await expect(
      wrongWindowService.create({ href: "https://example.com/", bounds: DEFAULT_BOUNDS, ownerWebContentsId: 7 }),
    ).rejects.toThrow(/owner window/i);
  });

  it("preserves the embedded page while product chrome temporarily occludes it", async () => {
    const owner = new FakeOwnerWindow(42);
    const nativeSurfaceOcclusion = createNativeSurfaceOcclusionCoordinator();
    const service = createService(owner, { nativeSurfaceOcclusion });
    await service.create({
      href: "https://example.com/",
      bounds: DEFAULT_BOUNDS,
      ownerWebContentsId: 42,
    });
    const view = createdViews[0];
    expect(view.visible).toBe(true);

    nativeSurfaceOcclusion.setOwnerOccluded(42, true);
    expect(view.visible).toBe(false);
    expect(view.webContents.audioMuted).toBe(true);
    expect(owner.children).toEqual([view]);
    expect(view.webContents.destroyed).toBe(false);

    nativeSurfaceOcclusion.setOwnerOccluded(42, false);
    expect(view.visible).toBe(true);
    expect(view.webContents.audioMuted).toBe(false);
    expect(owner.children).toEqual([view]);
  });

  it("requires explicit finite bounds, clips partial bounds and hides offscreen views", async () => {
    const owner = new FakeOwnerWindow(1, 500, 400);
    const service = createService(owner);
    await expect(
      service.create({ href: "https://example.com/", ownerWebContentsId: 1 }),
    ).rejects.toThrow(/bounds/i);

    const { id } = await service.create({
      href: "https://example.com/",
      bounds: { x: -20, y: 10, width: 100, height: 60 },
      ownerWebContentsId: 1,
    });
    const view = createdViews.at(-1);
    expect(view.bounds).toEqual({ x: 0, y: 10, width: 80, height: 60 });
    expect(view.visible).toBe(true);

    expect(service.setBounds({
      id,
      bounds: { x: -500, y: -500, width: 10, height: 10 },
      callerWebContentsId: 1,
    })).toEqual({ ok: true, visible: false });
    expect(view.visible).toBe(false);
    expect(view.webContents.audioMuted).toBe(true);
    expect(service.setBounds({
      id,
      bounds: { x: 1, y: 1, width: Number.POSITIVE_INFINITY, height: 10 },
      callerWebContentsId: 1,
    })).toEqual({ ok: false, visible: false });
  });

  it("destroys all native/session state when the owner closes", async () => {
    const owner = new FakeOwnerWindow(5);
    const service = createService(owner);
    const { id } = await service.create({
      href: "https://example.com/",
      bounds: DEFAULT_BOUNDS,
      ownerWebContentsId: 5,
    });
    const view = createdViews[0];
    const partitionSession = createdSessions[0];

    owner.close();
    expect(view.webContents.destroyed).toBe(true);
    expect(owner.children).toHaveLength(0);
    expect(service.destroy({ id, callerWebContentsId: 5 })).toEqual({ ok: false });
    await vi.waitFor(() => {
      expect(partitionSession.storageCleared).toBe(true);
      expect(partitionSession.connectionsClosed).toBe(true);
    });
  });

  it("destroys owner views when the application renderer crashes", async () => {
    const owner = new FakeOwnerWindow(5);
    const service = createService(owner);
    const { id } = await service.create({
      href: "https://example.com/",
      bounds: DEFAULT_BOUNDS,
      ownerWebContentsId: 5,
    });
    const view = createdViews[0];

    owner.webContents.emit("render-process-gone");
    expect(view.webContents.destroyed).toBe(true);
    expect(owner.children).toHaveLength(0);
    expect(service.destroy({ id, callerWebContentsId: 5 })).toEqual({ ok: false });
  });

  it("cleans up an attached view when load fails or times out", async () => {
    const owner = new FakeOwnerWindow(1);
    loadUrlImplementation = async () => { throw new Error("load failed"); };
    const failedService = createService(owner);
    await expect(failedService.create({
      href: "https://example.com/",
      bounds: DEFAULT_BOUNDS,
      ownerWebContentsId: 1,
    })).rejects.toThrow(/load failed/i);
    expect(owner.children).toHaveLength(0);
    expect(createdViews[0].webContents.destroyed).toBe(true);

    loadUrlImplementation = () => new Promise(() => undefined);
    const timeoutService = createService(owner, { loadTimeoutMs: 5 });
    await expect(timeoutService.create({
      href: "https://example.com/",
      bounds: DEFAULT_BOUNDS,
      ownerWebContentsId: 1,
    })).rejects.toThrow(/timed out/i);
    expect(createdViews.at(-1).webContents.stopped).toBe(true);
    expect(createdViews.at(-1).webContents.destroyed).toBe(true);
    expect(owner.children).toHaveLength(0);
  });

  it("caps concurrent remote views per owner", async () => {
    const owner = new FakeOwnerWindow(1);
    const service = createService(owner, { maxEmbedsPerOwner: 1, maxEmbedsTotal: 1 });
    const first = await service.create({
      href: "https://example.com/one",
      bounds: DEFAULT_BOUNDS,
      ownerWebContentsId: 1,
    });
    await expect(service.create({
      href: "https://example.com/two",
      bounds: DEFAULT_BOUNDS,
      ownerWebContentsId: 1,
    })).rejects.toThrow(/limit/i);
    expect(createdViews).toHaveLength(1);
    expect(service.destroy({ id: first.id, callerWebContentsId: 1 })).toEqual({ ok: true });
  });

  it("reserves capacity while an embed is still loading", async () => {
    const owner = new FakeOwnerWindow(1);
    const service = createService(owner, { maxEmbedsPerOwner: 1, maxEmbedsTotal: 1 });
    let finishLoad;
    loadUrlImplementation = () => new Promise((resolve) => {
      finishLoad = resolve;
    });

    const first = service.create({
      href: "https://example.com/one",
      bounds: DEFAULT_BOUNDS,
      ownerWebContentsId: 1,
    });
    await vi.waitFor(() => expect(finishLoad).toBeTypeOf("function"));
    await expect(service.create({
      href: "https://example.com/two",
      bounds: DEFAULT_BOUNDS,
      ownerWebContentsId: 1,
    })).rejects.toThrow(/limit/i);
    finishLoad();
    await expect(first).resolves.toMatchObject({ href: "https://example.com/one" });
  });

  it("throws when the owner window is unavailable", async () => {
    const service = createService(null);
    await expect(service.create({
      href: "https://example.com/",
      bounds: DEFAULT_BOUNDS,
      ownerWebContentsId: 7,
    })).rejects.toThrow(/owner window/i);
  });
});

describe("Markdown web embed IPC ownership", () => {
  it("accepts only a live application main-frame sender", async () => {
    const handlers = new Map();
    const calls = [];
    const service = {
      create: async (request) => { calls.push(request); return { id: "embed-1" }; },
      setBounds: () => ({ ok: true }),
      destroy: () => ({ ok: true }),
    };
    registerMarkdownWebEmbedIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      createMarkdownWebEmbedService: () => service,
      externalNavigation: { openDetached: vi.fn(() => true) },
      getOwnerWindow: () => null,
    });

    const sender = { id: 17, isDestroyed: () => false };
    const mainFrame = { url: "file:///app/index.html" };
    sender.mainFrame = mainFrame;
    await expect(handlers.get("markdown-web-embed:create")(
      { sender, senderFrame: {} },
      { href: "https://example.com/", bounds: DEFAULT_BOUNDS },
    )).rejects.toThrow(/main frame/i);

    await expect(handlers.get("markdown-web-embed:create")(
      { sender, senderFrame: mainFrame },
      { href: "https://example.com/", bounds: DEFAULT_BOUNDS },
    )).rejects.toThrow(/capability/i);

    await expect(handlers.get("markdown-web-embed:create")(
      { sender, senderFrame: mainFrame },
      { href: "https://example.com/", bounds: DEFAULT_BOUNDS, capability: DEFAULT_CAPABILITY },
    )).resolves.toEqual({ id: "embed-1" });
    expect(calls[0]).toMatchObject({
      ownerWebContentsId: 17,
      href: "https://example.com/",
      capability: DEFAULT_CAPABILITY,
    });
  });
});
