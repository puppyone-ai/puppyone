import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createItemDisplayManager } from "./display-manager.mjs";
import { createItemHostBudget } from "./resource-budget.mjs";
import { createNativeSurfacePointerPassthroughCoordinator } from "../native-surfaces/pointer-passthrough-coordinator.mjs";

function fixture({ capacity = 12, createViewFailure = false } = {}) {
  const budget = createItemHostBudget({ project: capacity });
  const owner = { id: 1, isDestroyed: () => false, getOSProcessId: () => 1, send: vi.fn(), sendInputEvent: vi.fn() };
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
