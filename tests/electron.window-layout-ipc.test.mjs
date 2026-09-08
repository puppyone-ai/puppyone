import { describe, expect, it, vi } from "vitest";
import { registerWindowLayoutIpcHandlers } from "../electron/main/ipc/window-layout-ipc.mjs";
import { reapplyWindowChromeProfile } from "../electron/main/window-chrome-profile.mjs";

describe("native window layout IPC", () => {
  it("raises the native minimum and expands an already narrower window", () => {
    const ownerWindow = createWindow({ width: 640 });
    const handler = register(ownerWindow);

    expect(handler(createEvent(), { width: 888 })).toEqual({
      applied: true,
      width: 888,
    });
    expect(ownerWindow.setMinimumSize).toHaveBeenCalledWith(888, 640);
    expect(ownerWindow.setSize).toHaveBeenCalledWith(888, 840, true);
  });

  it("never lowers the product-level 640px floor", () => {
    const ownerWindow = createWindow({ width: 900 });
    const handler = register(ownerWindow);

    expect(handler(createEvent(), { width: 320 })).toEqual({
      applied: true,
      width: 640,
    });
    expect(ownerWindow.setMinimumSize).toHaveBeenCalledWith(640, 640);
    expect(ownerWindow.setSize).not.toHaveBeenCalled();
  });

  it("ignores a renderer whose BrowserWindow has already been destroyed", () => {
    const ownerWindow = createWindow({ destroyed: true });
    const handler = register(ownerWindow);

    expect(handler(createEvent(), { width: 888 })).toEqual({ applied: false });
    expect(ownerWindow.setMinimumSize).not.toHaveBeenCalled();
  });

  it("reports the native full-screen state for adaptive window chrome", () => {
    const ownerWindow = createWindow({ fullScreen: true });
    const handlers = registerHandlers(ownerWindow);

    expect(handlers.get("window-layout:get-chrome-state")(createEvent())).toEqual({
      fullScreen: true,
      maximized: false,
    });
  });

  it("switches native buttons from the manifest-owned titlebar composition", () => {
    const ownerWindow = createWindow();
    const handlers = registerHandlers(ownerWindow);

    expect(handlers.get("window-layout:set-chrome-profile")(createEvent(), {
      titlebar: "windows-xp-luna-titlebar-v1",
    })).toEqual({ applied: true, customControls: true });
    expect(ownerWindow.setWindowButtonVisibility).toHaveBeenCalledWith(false);

    expect(handlers.get("window-layout:set-chrome-profile")(createEvent(), {
      titlebar: "default-titlebar-v1",
    })).toEqual({ applied: true, customControls: false });
    expect(ownerWindow.setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
    expect(ownerWindow.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 13, y: 12 });
    expect(ownerWindow.setWindowButtonPosition.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      ownerWindow.setWindowButtonVisibility.mock.invocationCallOrder.at(-1),
    );
  });

  it("falls back to the default native traffic-light position for unknown profiles", () => {
    const ownerWindow = createWindow();
    const handlers = registerHandlers(ownerWindow);
    const applyProfile = handlers.get("window-layout:set-chrome-profile");

    expect(applyProfile(createEvent(), {
      titlebar: "unknown-titlebar-v1",
    })).toEqual({ applied: true, customControls: false });
    expect(ownerWindow.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 13, y: 12 });
  });

  it("keeps native traffic lights hidden when macOS recreates window chrome", () => {
    const ownerWindow = createWindow();
    const handlers = registerHandlers(ownerWindow);

    handlers.get("window-layout:set-chrome-profile")(createEvent(), {
      titlebar: "windows-xp-luna-titlebar-v1",
    });
    ownerWindow.setWindowButtonVisibility.mockClear();

    expect(reapplyWindowChromeProfile(ownerWindow)).toMatchObject({ customControls: true });
    expect(ownerWindow.setWindowButtonVisibility).toHaveBeenCalledExactlyOnceWith(false);
    expect(ownerWindow.setWindowButtonPosition).not.toHaveBeenCalled();
  });

  it("keeps native traffic lights fixed when the leading rail changes", () => {
    const ownerWindow = createWindow();
    const handlers = registerHandlers(ownerWindow);
    const applyProfile = handlers.get("window-layout:set-chrome-profile");

    expect(applyProfile(createEvent(), {
      titlebar: "default-titlebar-v1",
      leadingRail: true,
    })).toEqual({
      applied: true,
      customControls: false,
    });
    expect(ownerWindow.setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
    expect(ownerWindow.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 13, y: 12 });
    ownerWindow.setWindowButtonVisibility.mockClear();
    ownerWindow.setWindowButtonPosition.mockClear();
    expect(reapplyWindowChromeProfile(ownerWindow)).toMatchObject({ customControls: false });
    expect(ownerWindow.setWindowButtonVisibility).not.toHaveBeenCalled();
    expect(ownerWindow.setWindowButtonPosition).toHaveBeenCalledExactlyOnceWith({ x: 13, y: 12 });

    expect(applyProfile(createEvent(), {
      titlebar: "default-titlebar-v1",
      leadingRail: false,
    })).toEqual({
      applied: true,
      customControls: false,
    });
    expect(ownerWindow.setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
    expect(ownerWindow.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 13, y: 12 });
  });

  it("keeps the platform-native controls outside macOS", () => {
    const ownerWindow = createWindow();
    const handlers = registerHandlers(ownerWindow, "windows");

    expect(handlers.get("window-layout:set-chrome-profile")(createEvent(), {
      titlebar: "default-titlebar-v1",
      leadingRail: true,
    })).toEqual({
      applied: true,
      customControls: false,
    });
    expect(ownerWindow.setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
    expect(ownerWindow.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 13, y: 12 });
  });

  it("repositions default traffic lights on focus without rebuilding their safe area", () => {
    const ownerWindow = createWindow();
    const handlers = registerHandlers(ownerWindow);

    handlers.get("window-layout:set-chrome-profile")(createEvent(), {
      titlebar: "default-titlebar-v1",
    });
    ownerWindow.setWindowButtonVisibility.mockClear();
    ownerWindow.setWindowButtonPosition.mockClear();

    expect(reapplyWindowChromeProfile(ownerWindow)).toMatchObject({ customControls: false });
    expect(ownerWindow.setWindowButtonVisibility).not.toHaveBeenCalled();
    expect(ownerWindow.setWindowButtonPosition).toHaveBeenCalledExactlyOnceWith({ x: 13, y: 12 });
  });

  it("executes only allowlisted renderer window actions", () => {
    const ownerWindow = createWindow();
    const handlers = registerHandlers(ownerWindow);
    const perform = handlers.get("window-layout:perform-window-action");

    expect(perform(createEvent(), { action: "minimize" })).toEqual({ applied: true });
    expect(perform(createEvent(), { action: "toggle-maximize" })).toEqual({ applied: true });
    expect(perform(createEvent(), { action: "close" })).toEqual({ applied: true });
    expect(perform(createEvent(), { action: "inspect" })).toEqual({ applied: false });
    expect(ownerWindow.minimize).toHaveBeenCalledOnce();
    expect(ownerWindow.maximize).toHaveBeenCalledOnce();
    expect(ownerWindow.close).toHaveBeenCalledOnce();
  });
});

function register(ownerWindow) {
  const handlers = registerHandlers(ownerWindow);
  const handler = handlers.get("window-layout:set-minimum-width");
  if (!handler) throw new Error("Window layout IPC handler was not registered.");
  return handler;
}

function registerHandlers(ownerWindow, platform = "macos") {
  const handlers = new Map();
  registerWindowLayoutIpcHandlers({
    ipcMain: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    },
    BrowserWindow: {
      fromWebContents: () => ownerWindow,
    },
    platform,
  });
  return handlers;
}

function createWindow({ destroyed = false, fullScreen = false, width = 900 } = {}) {
  return {
    getMinimumSize: vi.fn(() => [640, 640]),
    getSize: vi.fn(() => [width, 840]),
    isDestroyed: vi.fn(() => destroyed),
    isFullScreen: vi.fn(() => fullScreen),
    isMaximized: vi.fn(() => false),
    close: vi.fn(),
    maximize: vi.fn(),
    minimize: vi.fn(),
    setWindowButtonVisibility: vi.fn(),
    setWindowButtonPosition: vi.fn(),
    setMinimumSize: vi.fn(),
    setSize: vi.fn(),
    unmaximize: vi.fn(),
  };
}

function createEvent() {
  return { sender: { id: 1 } };
}
