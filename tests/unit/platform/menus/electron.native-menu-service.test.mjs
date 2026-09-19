import { describe, expect, it, vi } from "vitest";
import { createDesktopNativeMenuService } from "../../../../electron/main/native-menu-service.mjs";

function createHarness({ platform = "darwin" } = {}) {
  const Menu = {
    buildFromTemplate: vi.fn((template) => ({ template })),
    setApplicationMenu: vi.fn(),
  };
  const app = { name: "puppyone", dock: { setMenu: vi.fn() } };
  const actions = {
    checkForUpdates: vi.fn(),
    newWindow: vi.fn(),
    openThemesDirectory: vi.fn(),
    selectTheme: vi.fn(),
  };
  const labels = {
    "native.menu.file": "File",
    "native.menu.checkForUpdates": "Check for Updates…",
    "native.menu.theme": "Theme",
    "native.menu.theme.pack": "Visual Variant",
    "native.menu.theme.openFolder": "Open Themes Folder",
    "native.dock.newWindow": "New Window",
  };
  const service = createDesktopNativeMenuService({
    app,
    Menu,
    platform,
    t: (messageId) => labels[messageId] ?? messageId,
    onCheckForUpdates: actions.checkForUpdates,
    onNewWindow: actions.newWindow,
    onOpenThemesDirectory: actions.openThemesDirectory,
    onSelectTheme: actions.selectTheme,
  });
  return { actions, app, Menu, service };
}

describe("DesktopNativeMenuService", () => {
  it("installs a native macOS File menu and shares New Window with the Dock", async () => {
    const { actions, app, Menu, service } = createHarness();

    expect(service.refresh()).toEqual({ supported: true });
    expect(Menu.setApplicationMenu).toHaveBeenCalledOnce();
    expect(app.dock.setMenu).toHaveBeenCalledOnce();

    const applicationTemplate = Menu.buildFromTemplate.mock.calls[0][0];
    expect(applicationTemplate.map((item) => item.role ?? item.label)).toEqual([
      "puppyone",
      "File",
      "editMenu",
      "viewMenu",
      "Theme",
      "windowMenu",
      "help",
    ]);

    const appItems = applicationTemplate[0].submenu;
    const checkForUpdates = appItems.find((item) => item.id === "app.checkForUpdates");
    expect(appItems.map((item) => item.role ?? item.id ?? item.type)).toEqual([
      "about",
      "separator",
      "app.checkForUpdates",
      "separator",
      "services",
      "separator",
      "hide",
      "hideOthers",
      "unhide",
      "separator",
      "quit",
    ]);
    expect(checkForUpdates).toMatchObject({ label: "Check for Updates…" });

    const fileItems = applicationTemplate[1].submenu;
    const newWindow = fileItems.find((item) => item.id === "file.newWindow");
    expect(fileItems).toHaveLength(4);
    expect(fileItems.some(item => item.id === "file.manageExecutions")).toBe(true);
    expect(newWindow).toMatchObject({ label: "New Window", accelerator: "CmdOrCtrl+N" });
    expect(fileItems[1]).toEqual({ type: "separator" });
    expect(fileItems.at(-1)).toEqual({ role: "close" });

    newWindow.click();
    checkForUpdates.click();
    Menu.buildFromTemplate.mock.calls[1][0][0].click();
    await Promise.resolve();
    await Promise.resolve();

    expect(actions.newWindow).toHaveBeenCalledTimes(2);
    expect(actions.checkForUpdates).toHaveBeenCalledOnce();
  });

  it("builds one coordinated theme-pack group without Customize", async () => {
    const { actions, service } = createHarness();
    service.setThemeState({
      pack: "builtin.pack.forest",
      requiredTargets: ["application", "markdown", "csv"],
      themes: [
        { id: "default.neutral", name: "Neutral", targets: ["application", "markdown", "csv"] },
        { id: "default.warm", name: "Warm", targets: ["application", "markdown", "csv"] },
        { id: "builtin.pack.forest", name: "Forest", targets: ["application", "markdown", "csv"] },
        { id: "local.puppyone.custom-css", name: "My Custom CSS", targets: ["application", "markdown", "csv"] },
        { id: "builtin.markdown.newspaper", name: "Newspaper", targets: ["markdown"] },
        { id: "builtin.csv.ledger", name: "Ledger", targets: ["csv"] },
      ],
    });

    const themeMenu = service.createApplicationMenuTemplate()
      .find((item) => item.id === "themes");
    expect(themeMenu.label).toBe("Theme");
    expect(themeMenu.submenu.map((item) => item.label).filter(Boolean)).toEqual([
      "Visual Variant",
      "Open Themes Folder",
    ]);
    expect(themeMenu.submenu[0].submenu.map((item) => item.label)).toEqual([
      "Neutral",
      "Warm",
      "Forest",
    ]);
    expect(themeMenu.submenu[0].submenu.find((item) => item.label === "Forest"))
      .toMatchObject({ type: "radio", checked: true });
    expect(themeMenu.submenu[0].submenu.find((item) => item.label === "My Custom CSS"))
      .toBeUndefined();
    expect(themeMenu.submenu[0].submenu.find((item) => item.label === "Newspaper"))
      .toBeUndefined();
    expect(themeMenu.submenu[0].submenu.find((item) => item.label === "Ledger"))
      .toBeUndefined();

    themeMenu.submenu[0].submenu.find((item) => item.label === "Neutral").click();
    themeMenu.submenu.at(-1).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(actions.selectTheme).toHaveBeenCalledWith({ kind: "pack", themeId: "default.neutral" });
    expect(actions.selectTheme).toHaveBeenCalledTimes(1);
    expect(actions.openThemesDirectory).toHaveBeenCalledOnce();
  });

  it("does not replace native menus outside macOS", () => {
    const { app, Menu, service } = createHarness({ platform: "linux" });

    expect(service.refresh()).toEqual({ supported: false });
    expect(Menu.buildFromTemplate).not.toHaveBeenCalled();
    expect(Menu.setApplicationMenu).not.toHaveBeenCalled();
    expect(app.dock.setMenu).not.toHaveBeenCalled();
  });
});
