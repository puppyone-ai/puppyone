import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createItemDisplayManager } from "./display-manager.mjs";
import { createItemHostBudget } from "./resource-budget.mjs";
import { createNativeSurfacePointerPassthroughCoordinator } from "../native-surfaces/pointer-passthrough-coordinator.mjs";

function fixture({ capacity = 12, createViewFailure = false } = {}) {
  const budget = createItemHostBudget({ project: capacity });
  const owner = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, getOSProcessId: () => 1, send: vi.fn(), sendInputEvent: vi.fn() });
  const context = { projectId: "project", generation: "open-1", rootPath: "/fixture" };
  const window = Object.assign(new EventEmitter(), { webContents: owner, isDestroyed: () => false,
    isVisible: () => true, isFocused: vi.fn(() => true), getContentSize: () => [1000, 800], contentView: { addChildView() {}, removeChildView() {} } });
  const pointer = createNativeSurfacePointerPassthroughCoordinator();
  const leases = new Map();
  const terminalService = {
    create: vi.fn(async (_sender, request) => {
      const lease = budget.reserve({ key: request.id, ownerId: owner.id, projectId: context.projectId, kind: "terminal" });
      leases.set(request.id, lease);
      lease.ready();
      return { id: request.id, instanceId: "instance-1", pid: 2 };
    }),
    close: vi.fn(async (_sender, receipt) => { leases.get(receipt.id)?.release(); leases.delete(receipt.id); }),
    cancelCreation: vi.fn(async (_sender, id) => { leases.get(id)?.release(); leases.delete(id); }),
  };
  const authority = { register: vi.fn(), unregister: vi.fn() };
  let manager;
  let nextId = 100;
  class View {
    constructor() {
      if (createViewFailure) throw new Error("view construction failed");
      let destroyed = false;
      const pid = ++nextId;
      this.webContents = Object.assign(new EventEmitter(), { id: pid, isDestroyed: () => destroyed,
        getOSProcessId: () => pid, setWindowOpenHandler() {}, send() {},
        isFocused: () => true, focus: vi.fn(() => this.webContents.emit("focus")),
        loadURL: async () => { manager.ready(manager.values().find((entry) => entry.view === this)); },
        close: () => {
          this.webContents.emit("render-process-gone");
          destroyed = true;
          this.webContents.emit("destroyed");
        },
      });
      this.setVisible = vi.fn();
    }
    setBounds() {}
    getBounds() { return { x: 0, y: 0, width: 400, height: 600 }; }
  }
  manager = createItemDisplayManager({ WebContentsView: View, budget, authority, getOwnerWindow: () => window,
    electronSession: { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }) },
    projectSessions: { require: () => context, run: (_owner, _context, operation) => operation({ assertCurrent() {} }) },
    terminalService, agentService: { closeItem: vi.fn() }, attachmentStore: { revoke: vi.fn() },
    applicationUrl: "file:///app/index.html", preloadPath: "/app/item-preload.cjs",
    nativeSurfacePointerPassthrough: pointer,
  });
  const request = { itemId: "terminal-fixture", kind: "terminal", projectContext: context };
  return { manager, owner, request, terminalService, budget, authority, window, pointer };
}

describe("item display lifecycle", () => {
  it("shares one owner subscription across items and releases it after the last display", async () => {
    const { manager, owner, request } = fixture();
    const second = { ...request, itemId: "terminal-second" };
    try {
      await manager.create(owner, request);
      await manager.create(owner, second);
      expect(owner.listenerCount("did-start-navigation")).toBe(1);
      expect(owner.listenerCount("render-process-gone")).toBe(1);
      expect(owner.listenerCount("destroyed")).toBe(1);
      owner.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      expect(manager.values().every((entry) => entry.presentationDetached)).toBe(true);
      await manager.recover(owner, request);
      await manager.close(owner, request);
      expect(owner.listenerCount("did-start-navigation")).toBe(1);
    } finally { await manager.closeAll(); }
    expect(owner.listenerCount("did-start-navigation")).toBe(0);
    expect(owner.listenerCount("render-process-gone")).toBe(0);
    expect(owner.listenerCount("destroyed")).toBe(0);
  });

  it.each(["reload", "crash", "destroy"])("revokes native presentation after owner %s without closing execution", async (reason) => {
    const { manager, owner, request, terminalService, window } = fixture();
    try {
      const initial = await manager.create(owner, request);
      const entry = manager.values()[0];
      const wc = entry.view.webContents;
      const geometry = { ...request, generation: initial.generation, presentationId: 1, revision: 1,
        visible: true, bounds: { x: 0, y: 0, width: 400, height: 600 } };
      manager.configure(owner, { ...geometry, presented: true, commandTarget: true });
      manager.geometry(owner, geometry);
      owner.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
      owner.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
      expect(entry.attachment.isVisible()).toBe(true);
      const pendingReference = expect(manager.request(entry, "resolve-reference", {})).rejects.toMatchObject({ code: "HOST_DISPLAY_DETACHED" });
      wc.emit("focus");
      owner.send.mockClear();
      if (reason === "reload") owner.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      else owner.emit(reason === "crash" ? "render-process-gone" : "destroyed");
      await pendingReference;
      expect(entry.attachment.isVisible()).toBe(false);
      expect(entry.configuration).toMatchObject({ presented: false, commandTarget: false });
      expect(entry.display).toBe("crashed");
      expect(wc.isDestroyed()).toBe(false);
      expect(terminalService.close).not.toHaveBeenCalled();
      manager.geometry(owner, { ...geometry, revision: 100 });
      manager.configure(owner, { ...geometry, presented: true, commandTarget: true });
      manager.ready(entry);
      window.emit("show");
      wc.emit("unresponsive");
      wc.emit("responsive");
      manager.focus(owner, geometry);
      manager.publish(entry, "summary", { snapshot: { resourceId: "retained-session" } });
      expect(owner.send).not.toHaveBeenCalled();
      expect(() => manager.request(entry, "resolve-reference", {})).toThrow("workspace view is no longer available");
      expect(entry.attachment.isVisible()).toBe(false);
      expect(entry.display).toBe("crashed");
      expect(entry.configuration.presented).toBe(false);
      expect(wc.focus).not.toHaveBeenCalled();
      const recovered = await manager.recover(owner, request);
      manager.configure(owner, { ...geometry, generation: recovered.generation, presented: true });
      manager.geometry(owner, { ...geometry, generation: recovered.generation, revision: 2 });
      expect(entry.attachment.isVisible()).toBe(true);
      expect(terminalService.create).toHaveBeenCalledTimes(1);
      expect(terminalService.close).not.toHaveBeenCalled();
      expect(owner.listenerCount("did-start-navigation")).toBe(1);
    } finally { await manager.closeAll(); }
    expect(owner.listenerCount("did-start-navigation")).toBe(0);
    expect(owner.listenerCount("render-process-gone")).toBe(0);
    expect(owner.listenerCount("destroyed")).toBe(0);
  });

  it("keeps a collapsed item hidden when stale visible geometry arrives", async () => {
    const { manager, owner, request, terminalService } = fixture();
    try {
      const initial = await manager.create(owner, request);
      const entry = manager.values()[0];
      const geometry = { ...request, generation: initial.generation, presentationId: 1, revision: 1,
        visible: true, bounds: { x: 0, y: 0, width: 400, height: 600 } };
      manager.configure(owner, { ...geometry, presented: true });
      manager.geometry(owner, geometry);
      expect(entry.attachment.isVisible()).toBe(true);
      manager.configure(owner, { ...geometry, presented: false, commandTarget: false });
      manager.geometry(owner, { ...geometry, revision: 2 });
      expect(entry.attachment.isVisible()).toBe(false);
      manager.configure(owner, { ...geometry, presented: true });
      expect(entry.attachment.isVisible()).toBe(true);
      expect(terminalService.close).not.toHaveBeenCalled();
      expect(terminalService.create).toHaveBeenCalledTimes(1);
    } finally { await manager.closeAll(); }
  });
  it("rejects full display capacity before any terminal create request", async () => {
    const { manager, owner, request, terminalService, budget } = fixture({ capacity: 0 });
    await expect(manager.create(owner, request)).rejects.toMatchObject({ code: "HOST_BUDGET_EXHAUSTED" });
    expect(terminalService.create).not.toHaveBeenCalled();
    expect(budget.snapshot()).toHaveLength(0);
    expect(manager.values()).toHaveLength(0);
  });

  it("releases the display reservation when execution admission fails before spawning", async () => {
    const { manager, owner, request, terminalService, budget } = fixture({ capacity: 1 });
    await expect(manager.create(owner, request)).rejects.toMatchObject({ code: "HOST_BUDGET_EXHAUSTED" });
    expect(terminalService.close).not.toHaveBeenCalled();
    expect(budget.snapshot()).toHaveLength(0);
  });

  it("rolls back both leases if the native view constructor fails", async () => {
    const { manager, owner, request, terminalService, budget } = fixture({ createViewFailure: true });
    await expect(manager.create(owner, request)).rejects.toThrow("view construction failed");
    expect(terminalService.close).toHaveBeenCalledTimes(1);
    expect(budget.snapshot()).toHaveLength(0);
    expect(manager.values()).toHaveLength(0);
  });

  it("coalesces display recovery without recreating execution, then closes once", async () => {
    const { manager, owner, request, terminalService, budget } = fixture();
    try {
      const first = await manager.create(owner, request);
      const [a, b] = await Promise.all([manager.recover(owner, request), manager.recover(owner, request)]);
      expect(a.generation).toBe(b.generation);
      expect(a.generation).not.toBe(first.generation);
      expect(terminalService.create).toHaveBeenCalledTimes(1);
      expect(budget.snapshot()).toHaveLength(2);
      await Promise.all([manager.close(owner, request), manager.close(owner, request)]);
      expect(terminalService.close).toHaveBeenCalledTimes(1);
      expect(budget.snapshot()).toHaveLength(0);
    } finally { await manager.closeAll(); }
  });

  it("does not unhide interrupted execution on a late responsive event", async () => {
    const { manager, owner, request } = fixture();
    try {
      await manager.create(owner, request);
      const entry = manager.values()[0];
      manager.geometry(owner, { ...request, generation: entry.generation, presentationId: 1, revision: 1, visible: true, bounds: { x: 0, y: 0, width: 400, height: 600 } });
      entry.view.webContents.emit("unresponsive");
      manager.hostEvent({ ownerId: owner.id, id: request.itemId }, { type: "host-exited", expected: false });
      entry.view.webContents.emit("responsive");
      expect(entry.execution).toBe("interrupted");
      expect(entry.view.setVisible).toHaveBeenLastCalledWith(false);
      expect(entry.message).toMatch(/execution process exited/);
    } finally { await manager.closeAll(); }
  });

  it("rejects retired mounts and display generations without resetting geometry order", async () => {
    const { manager, owner, request, terminalService } = fixture();
    try {
      const first = await manager.create(owner, request);
      const entry = manager.values()[0];
      const geometry = { ...request, generation: first.generation, presentationId: 1,
        revision: 1, visible: true, bounds: { x: 0, y: 0, width: 400, height: 600 } };
      manager.geometry(owner, geometry);
      expect(entry.attachment.isVisible()).toBe(true);
      manager.geometry(owner, { ...geometry, revision: 2, visible: false });
      manager.geometry(owner, { ...geometry, presentationId: 2, revision: 3 });
      manager.geometry(owner, { ...geometry, revision: 100, visible: false });
      expect(entry.attachment.isVisible()).toBe(true);
      manager.configure(owner, { ...geometry, presentationId: 2, settings: { fixture: true } });
      manager.configure(owner, { ...geometry, presentationId: 2, presented: false });
      expect(entry.configuration.settings).toEqual({ fixture: true });
      const recovered = await manager.recover(owner, request);
      manager.geometry(owner, { ...geometry, presentationId: 2, revision: 200 });
      expect(entry.attachment.isVisible()).toBe(false);
      manager.geometry(owner, { ...geometry, generation: recovered.generation, presentationId: 2, revision: 4 });
      expect(entry.attachment.isVisible()).toBe(false);
      manager.configure(owner, { ...geometry, generation: recovered.generation, presentationId: 2, presented: true });
      expect(entry.attachment.isVisible()).toBe(true);
      expect(terminalService.create).toHaveBeenCalledTimes(1);
    } finally { await manager.closeAll(); }
  });

  it("observes actual native input, gates hidden focus, and detaches window listeners", async () => {
    const { manager, owner, request, window, pointer } = fixture();
    try {
      const first = await manager.create(owner, request);
      const entry = manager.values()[0];
      const wc = entry.view.webContents;
      const identity = { ...request, generation: first.generation, presentationId: 1 };
      manager.focus(owner, identity);
      expect(wc.focus).not.toHaveBeenCalled();
      manager.geometry(owner, { ...identity, revision: 1, visible: true, bounds: { x: 0, y: 0, width: 400, height: 600 } });
      wc.emit("focus");
      const focusEvents = () => owner.send.mock.calls.filter(([channel]) => channel === "item-host:event").map(([, event]) => event.payload);
      expect(focusEvents().at(-1)).toMatchObject({ presentationId: 1, focused: true, activate: true });
      manager.focus(owner, identity);
      expect(focusEvents().at(-1)).toMatchObject({ focused: true, activate: false });
      wc.focus.mockClear();
      window.isFocused.mockReturnValue(false);
      window.emit("blur");
      expect(focusEvents().at(-1)).toMatchObject({ focused: false, activate: false });
      manager.focus(owner, identity);
      expect(wc.focus).not.toHaveBeenCalled();
      window.isFocused.mockReturnValue(true);
      window.emit("focus");
      expect(focusEvents().at(-1)).toMatchObject({ focused: true, activate: false });
      owner.send.mockClear();
      pointer.setOwnerRoutingRegions(owner.id, [{ x: 0, y: 0, width: 8, height: 600 }]);
      wc.emit("before-mouse-event", { preventDefault: vi.fn() }, { type: "mouseDown", x: 2, y: 20 });
      expect(focusEvents()).toHaveLength(0);
      pointer.setOwnerActive(owner.id, false);
      wc.emit("before-mouse-event", {}, { type: "mouseDown", x: 200, y: 20 });
      expect(focusEvents().at(-1)).toMatchObject({ focused: true, activate: true });
      manager.geometry(owner, { ...identity, revision: 2, visible: false, bounds: { x: 0, y: 0, width: 400, height: 600 } });
      owner.send.mockClear();
      wc.emit("focus");
      expect(focusEvents()).toHaveLength(0);
      await manager.recover(owner, request);
      expect(window.listenerCount("focus")).toBe(1);
      wc.emit("focus");
      expect(focusEvents()).toHaveLength(0);
    } finally { await manager.closeAll(); }
    expect(window.listenerCount("focus")).toBe(0);
    expect(window.listenerCount("blur")).toBe(0);
    expect(() => manager.configure(owner, { ...request, generation: "closed", presentationId: 1, presented: false })).not.toThrow();
  });
});
