import { describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_WINDOW_BACKGROUND_CHANNEL,
  registerAppearanceIpcHandlers,
} from "../../../../electron/main/ipc/appearance-ipc.mjs";

describe("native appearance IPC", () => {
  it("applies a manifest-owned first-paint color to the sender's window", () => {
    const ownerWindow = createWindow();
    const { handler, nativeTheme } = register(ownerWindow);

    handler(createEvent(), { background: "#fafafa", themeSource: "light" });

    expect(ownerWindow.setBackgroundColor).toHaveBeenCalledWith("#fafafa");
    expect(nativeTheme.themeSource).toBe("light");
  });

  it("keeps native window chrome on the renderer's dark appearance", () => {
    const ownerWindow = createWindow();
    const { handler, nativeTheme } = register(ownerWindow);

    handler(createEvent(), { background: "#161413", themeSource: "dark" });

    expect(ownerWindow.setBackgroundColor).toHaveBeenCalledWith("#161413");
    expect(nativeTheme.themeSource).toBe("dark");
  });

  it("preserves native system following when the renderer follows the system", () => {
    const ownerWindow = createWindow();
    const { handler, nativeTheme } = register(ownerWindow);

    handler(createEvent(), { background: "#fafafa", themeSource: "system" });

    expect(ownerWindow.setBackgroundColor).toHaveBeenCalledWith("#fafafa");
    expect(nativeTheme.themeSource).toBe("system");
  });

  it("accepts compiler-shaped opaque colors from local Sub Themes", () => {
    const ownerWindow = createWindow();
    const { handler } = register(ownerWindow);

    handler(createEvent(), { background: "#ff00ff", themeSource: "light" });

    expect(ownerWindow.setBackgroundColor).toHaveBeenCalledWith("#ff00ff");
  });

  it("lets the platform adapter synchronize its titlebar appearance", () => {
    const ownerWindow = createWindow();
    const windowChrome = { synchronizeAppearance: vi.fn() };
    const { handler } = register(ownerWindow, { windowChrome });

    handler(createEvent(), {
      background: "#161413",
      titlebarBackground: "rgb(38, 36, 35)",
      themeSource: "dark",
    });

    expect(windowChrome.synchronizeAppearance).toHaveBeenCalledWith(ownerWindow, {
      background: "#161413",
      titlebarBackground: "rgb(38, 36, 35)",
      themeSource: "dark",
    });
  });

  it("rejects values outside the opaque first-paint contract", () => {
    const ownerWindow = createWindow();
    const { handler } = register(ownerWindow);

    handler(createEvent(), { background: "linear-gradient(red, blue)", themeSource: "light" });
    handler(createEvent(), { background: "#fff8", themeSource: "light" });

    expect(ownerWindow.setBackgroundColor).not.toHaveBeenCalled();
  });

  it("rejects unsupported native color schemes", () => {
    const ownerWindow = createWindow();
    const { handler, nativeTheme } = register(ownerWindow);

    handler(createEvent(), { background: "#fafafa", themeSource: "sepia" });

    expect(ownerWindow.setBackgroundColor).not.toHaveBeenCalled();
    expect(nativeTheme.themeSource).toBe("system");
  });

  it("does not touch a destroyed sender window", () => {
    const ownerWindow = createWindow({ destroyed: true });
    const { handler } = register(ownerWindow);

    handler(createEvent(), { background: "#161413", themeSource: "dark" });

    expect(ownerWindow.setBackgroundColor).not.toHaveBeenCalled();
  });
});

function register(ownerWindow, { windowChrome = null } = {}) {
  let handler;
  const nativeTheme = { themeSource: "system" };
  registerAppearanceIpcHandlers({
    ipcMain: {
      on: (channel, listener) => {
        expect(channel).toBe(APPEARANCE_WINDOW_BACKGROUND_CHANNEL);
        handler = listener;
      },
    },
    BrowserWindow: {
      fromWebContents: () => ownerWindow,
    },
    nativeTheme,
    windowChrome,
  });
  if (!handler) throw new Error("Appearance IPC handler was not registered.");
  return { handler, nativeTheme };
}

function createWindow({ destroyed = false } = {}) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    setBackgroundColor: vi.fn(),
  };
}

function createEvent() {
  return { sender: { id: 1 } };
}
