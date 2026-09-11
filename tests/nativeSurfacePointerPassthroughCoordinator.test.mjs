import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createNativeSurfacePointerPassthroughCoordinator } from "../electron/main/native-surfaces/pointer-passthrough-coordinator.mjs";

describe("native surface pointer passthrough coordinator", () => {
  it("routes an initial primary press only inside a registered renderer region", () => {
    const ownerWebContents = { sendInputEvent: vi.fn() };
    const surfaceWebContents = new EventEmitter();
    const surfaceView = {
      getBounds: () => ({ x: 320, y: 40, width: 600, height: 420 }),
      webContents: surfaceWebContents,
    };
    const coordinator = createNativeSurfacePointerPassthroughCoordinator();
    coordinator.register({ ownerWebContentsId: 7, ownerWebContents, surfaceView });
    coordinator.setOwnerRoutingRegions(7, [
      { x: 320, y: 40, width: 8, height: 420 },
    ]);

    surfaceWebContents.emit("before-mouse-event", { preventDefault: vi.fn() }, {
      type: "mouseDown",
      button: "left",
      x: 20,
      y: 30,
    });
    expect(ownerWebContents.sendInputEvent).not.toHaveBeenCalled();

    const preventRight = vi.fn();
    surfaceWebContents.emit("before-mouse-event", { preventDefault: preventRight }, {
      type: "mouseDown",
      button: "right",
      x: 4,
      y: 30,
    });
    expect(preventRight).not.toHaveBeenCalled();

    const preventPrimary = vi.fn();
    surfaceWebContents.emit("before-mouse-event", { preventDefault: preventPrimary }, {
      type: "mouseDown",
      button: "left",
      clickCount: 1,
      x: 4,
      y: 30,
    });
    expect(preventPrimary).toHaveBeenCalledOnce();
    expect(ownerWebContents.sendInputEvent).toHaveBeenLastCalledWith({
      type: "mouseDown",
      button: "left",
      clickCount: 1,
      x: 324,
      y: 70,
    });
    expect(coordinator.isOwnerActive(7)).toBe(true);
  });

  it("forwards active child-view move/up input into owner coordinates without hiding the view", () => {
    const ownerWebContents = { sendInputEvent: vi.fn() };
    const surfaceWebContents = new EventEmitter();
    const surfaceView = {
      getBounds: () => ({ x: 108, y: 40, width: 600, height: 420 }),
      webContents: surfaceWebContents,
    };
    const coordinator = createNativeSurfacePointerPassthroughCoordinator();
    coordinator.register({ ownerWebContentsId: 7, ownerWebContents, surfaceView });

    const preventMove = vi.fn();
    surfaceWebContents.emit("before-mouse-event", { preventDefault: preventMove }, {
      type: "mouseMove",
      x: 22,
      y: 30,
      movementX: 3,
      movementY: 0,
    });
    expect(ownerWebContents.sendInputEvent).not.toHaveBeenCalled();

    coordinator.setOwnerActive(7, true);
    surfaceWebContents.emit("before-mouse-event", { preventDefault: preventMove }, {
      type: "mouseMove",
      x: 22,
      y: 30,
      movementX: 3,
      movementY: 0,
    });
    expect(preventMove).toHaveBeenCalledOnce();
    expect(ownerWebContents.sendInputEvent).toHaveBeenLastCalledWith({
      type: "mouseMove",
      x: 130,
      y: 70,
      movementX: 3,
      movementY: 0,
    });

    surfaceWebContents.emit("before-mouse-event", { preventDefault: vi.fn() }, {
      type: "mouseUp",
      button: "left",
      clickCount: 1,
      x: 30,
      y: 30,
    });
    expect(ownerWebContents.sendInputEvent).toHaveBeenLastCalledWith({
      type: "mouseUp",
      button: "left",
      clickCount: 1,
      x: 138,
      y: 70,
    });
    expect(coordinator.isOwnerActive(7)).toBe(false);
  });

  it("removes child-view listeners on registration release and disposal", () => {
    const ownerWebContents = { sendInputEvent: vi.fn() };
    const first = new EventEmitter();
    const second = new EventEmitter();
    const coordinator = createNativeSurfacePointerPassthroughCoordinator();
    const release = coordinator.register({
      ownerWebContentsId: 9,
      ownerWebContents,
      surfaceView: { getBounds: vi.fn(), webContents: first },
    });
    coordinator.register({
      ownerWebContentsId: 9,
      ownerWebContents,
      surfaceView: { getBounds: vi.fn(), webContents: second },
    });

    expect(first.listenerCount("before-mouse-event")).toBe(1);
    release();
    release();
    expect(first.listenerCount("before-mouse-event")).toBe(0);
    coordinator.dispose();
    expect(second.listenerCount("before-mouse-event")).toBe(0);
  });

  it("preserves a native pressed button on forwarded moves even without modifiers", () => {
    const ownerWebContents = { sendInputEvent: vi.fn() };
    const surfaceWebContents = new EventEmitter();
    const coordinator = createNativeSurfacePointerPassthroughCoordinator();
    coordinator.register({ ownerWebContentsId: 7, ownerWebContents,
      surfaceView: { getBounds: () => ({ x: 100, y: 0 }), webContents: surfaceWebContents } });
    coordinator.setOwnerActive(7, true);
    surfaceWebContents.emit("before-mouse-event", { preventDefault() {} }, { type: "mouseMove", button: "left", x: 20, y: 30 });
    expect(ownerWebContents.sendInputEvent).toHaveBeenLastCalledWith({ type: "mouseMove", button: "left", x: 120, y: 30, modifiers: ["leftbuttondown"] });
    surfaceWebContents.emit("before-mouse-event", { preventDefault() {} }, { type: "mouseMove", button: "left", x: 20, y: 30, modifiers: ["shift", "leftbuttondown"] });
    expect(ownerWebContents.sendInputEvent.mock.lastCall[0].modifiers).toEqual(["shift", "leftbuttondown"]);
    coordinator.dispose();
  });
});

describe("native pane-edge discovery", () => {
  it("reports passive hover without stealing input or focus, then clears it on leave and DOM entry", () => {
    const owner = Object.assign(new EventEmitter(), { send: vi.fn(), sendInputEvent: vi.fn(), focus: vi.fn() });
    const child = new EventEmitter();
    const coordinator = createNativeSurfacePointerPassthroughCoordinator();
    const release = coordinator.register({ ownerWebContentsId: 7, ownerWebContents: owner,
      surfaceView: { webContents: child, getBounds: () => ({ x: 803, y: 76 }) } });
    coordinator.setOwnerRoutingRegions(7, [{ id: 9, cursor: "col-resize", x: 800, y: 38, width: 8, height: 962 }]);
    const event = { preventDefault: vi.fn() };
    child.emit("before-mouse-event", event, { type: "mouseMove", x: 1, y: 60 });
    expect(owner.send).toHaveBeenLastCalledWith("native-surfaces:pointer-hover", { regionId: 9 });
    expect(owner.sendInputEvent).not.toHaveBeenCalled();
    expect(owner.focus).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(coordinator.isOwnerActive(7)).toBe(false);
    child.emit("before-mouse-event", event, { type: "mouseMove", x: 30, y: 60 });
    expect(owner.send).toHaveBeenLastCalledWith("native-surfaces:pointer-hover", { regionId: null });
    child.emit("before-mouse-event", event, { type: "mouseMove", x: 1, y: 60 });
    owner.emit("before-mouse-event", event, { type: "mouseMove", x: 700, y: 50 });
    expect(owner.send).toHaveBeenLastCalledWith("native-surfaces:pointer-hover", { regionId: null });
    release(); expect(owner.listenerCount("before-mouse-event")).toBe(0);
    coordinator.dispose();
  });
});
