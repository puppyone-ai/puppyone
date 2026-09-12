import { describe, expect, it, vi } from "vitest";
import {
  THEME_CREATE_CHANNEL,
  THEME_LIST_CHANNEL,
  THEME_OPEN_DIRECTORY_CHANNEL,
  THEME_SYNC_NATIVE_MENU_CHANNEL,
  registerThemeIpcHandlers,
} from "../../../../electron/main/ipc/theme-ipc.mjs";

describe("CSS theme IPC", () => {
  it("registers narrow list, open-directory, create, and native-menu handlers", async () => {
    const handlers = new Map();
    const ipcMain = {
      handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    };
    const snapshot = { themes: [], diagnostics: [] };
    const themeService = {
      listThemes: vi.fn(async () => snapshot),
      openDirectory: vi.fn(async () => ({ opened: true })),
      createTheme: vi.fn(async () => ({ created: true, themeId: "local.user.custom-theme" })),
    };
    const onSyncNativeMenu = vi.fn();

    registerThemeIpcHandlers({ ipcMain, themeService, onSyncNativeMenu });

    expect([...handlers.keys()]).toEqual([
      THEME_LIST_CHANNEL,
      THEME_OPEN_DIRECTORY_CHANNEL,
      THEME_CREATE_CHANNEL,
      THEME_SYNC_NATIVE_MENU_CHANNEL,
    ]);
    await expect(handlers.get(THEME_LIST_CHANNEL)({})).resolves.toBe(snapshot);
    await expect(handlers.get(THEME_OPEN_DIRECTORY_CHANNEL)({}, "/tmp")).resolves.toEqual({ opened: true });
    expect(themeService.listThemes).toHaveBeenCalledOnce();
    expect(themeService.openDirectory).toHaveBeenCalledExactlyOnceWith();
    await expect(handlers.get(THEME_CREATE_CHANNEL)({})).resolves.toEqual({
      created: true,
      themeId: "local.user.custom-theme",
    });
    expect(themeService.createTheme).toHaveBeenCalledExactlyOnceWith();
    expect(handlers.get(THEME_SYNC_NATIVE_MENU_CHANNEL)({}, {
      pack: "builtin.pack.forest",
      themes: [{ id: "builtin.markdown.focus", name: "Focus", targets: ["markdown", "invalid"] }],
    })).toEqual({ synced: true });
    expect(onSyncNativeMenu).toHaveBeenCalledWith({
      pack: "builtin.pack.forest",
      requiredTargets: Object.freeze(["application", "markdown", "csv"]),
      themes: [{ id: "builtin.markdown.focus", name: "Focus", targets: ["markdown"] }],
    });

    expect(handlers.get(THEME_SYNC_NATIVE_MENU_CHANNEL)({}, {
      pack: "default",
      themes: [
        { id: "default.neutral", name: "Neutral", targets: ["application", "markdown", "csv"] },
        { id: "default.warm", name: "Warm", targets: ["application", "markdown", "csv"] },
        { id: "builtin.pack.forest", name: "Forest", targets: ["application", "markdown", "csv"] },
      ],
    })).toEqual({ synced: true });
    expect(onSyncNativeMenu).toHaveBeenLastCalledWith({
      pack: "default.neutral",
      requiredTargets: Object.freeze(["application", "markdown", "csv"]),
      themes: [
        { id: "default.neutral", name: "Neutral", targets: Object.freeze(["application", "markdown", "csv"]) },
        { id: "default.warm", name: "Warm", targets: Object.freeze(["application", "markdown", "csv"]) },
        { id: "builtin.pack.forest", name: "Forest", targets: Object.freeze(["application", "markdown", "csv"]) },
      ],
    });
  });

  it("requires the trusted IPC and theme service ports", () => {
    expect(() => registerThemeIpcHandlers({ ipcMain: null, themeService: {} }))
      .toThrow("Trusted ipcMain is required");
    expect(() => registerThemeIpcHandlers({ ipcMain: { handle() {} }, themeService: {} }))
      .toThrow("Theme service is required");
  });

  it("bounds renderer-controlled theme menu metadata before it reaches the main menu", () => {
    const handlers = new Map();
    const onSyncNativeMenu = vi.fn();
    registerThemeIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      themeService: {
        listThemes: vi.fn(),
        openDirectory: vi.fn(),
        createTheme: vi.fn(),
      },
      onSyncNativeMenu,
    });

    handlers.get(THEME_SYNC_NATIVE_MENU_CHANNEL)({}, {
      pack: `default.${"a".repeat(200)}`,
      requiredTargets: ["markdown", ...Array.from({ length: 32 }, () => "invalid"), "csv"],
      themes: [{
        id: `default.${"b".repeat(200)}`,
        name: `${"Theme".repeat(30)} ignored suffix`,
        targets: ["markdown"],
      }],
    });

    expect(onSyncNativeMenu).toHaveBeenCalledWith({
      pack: "default.neutral",
      requiredTargets: ["markdown"],
      themes: [],
    });
  });
});
