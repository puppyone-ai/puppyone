import { describe, expect, it, vi } from "vitest";
import { NATIVE_MENU_COMMAND_SYMBOLS, createDesktopNativeMenuService } from "../../../../electron/main/native-menu-service.mjs";

function createHarness({ platform = "darwin", menuSymbol } = {}) {
  const Menu = {
    buildFromTemplate: vi.fn((template) => ({ template })),
    setApplicationMenu: vi.fn(),
  };
  const app = { name: "puppyone", dock: { setMenu: vi.fn() } };
  const actions = {
    checkForUpdates: vi.fn(),
    newWindow: vi.fn(),
    openSettings: vi.fn(),
    openThemesDirectory: vi.fn(),
    selectTheme: vi.fn(),
  };
  const labels = {
    "native.menu.file": "File",
    "native.menu.checkForUpdates": "Check for Updates…",
    "native.menu.settings": "Settings…",
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
    onOpenSettings: actions.openSettings,
    onOpenThemesDirectory: actions.openThemesDirectory,
    onSelectTheme: actions.selectTheme,
    ...(menuSymbol ? { menuSymbol } : {}),
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
    const settings = appItems.find((item) => item.id === "app.settings");
    expect(appItems.map((item) => item.role ?? item.id ?? item.type)).toEqual([
      "about",
      "app.checkForUpdates",
      "separator",
      "app.settings",
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
    expect(settings).toMatchObject({ label: "Settings…", accelerator: "CmdOrCtrl+," });

    const fileItems = applicationTemplate[1].submenu;
    const newWindow = fileItems.find((item) => item.id === "file.newWindow");
    expect(fileItems).toHaveLength(4);
    expect(fileItems.some(item => item.id === "file.manageExecutions")).toBe(true);
    expect(newWindow).toMatchObject({ label: "New Window", accelerator: "CmdOrCtrl+N" });
    expect(fileItems[1]).toEqual({ type: "separator" });
    expect(fileItems.at(-1)).toEqual({ role: "close" });

    newWindow.click();
    checkForUpdates.click();
    settings.click();
    Menu.buildFromTemplate.mock.calls[1][0][0].click();
    await Promise.resolve();
    await Promise.resolve();

    expect(actions.newWindow).toHaveBeenCalledTimes(2);
    expect(actions.checkForUpdates).toHaveBeenCalledOnce();
    expect(actions.openSettings).toHaveBeenCalledOnce();
  });

  it("gives every custom command an SF Symbol and leaves standard roles to AppKit", () => {
    const menuSymbol = vi.fn((symbolName) => ({ symbolName }));
    const { service } = createHarness({ menuSymbol });
    const template = service.createApplicationMenuTemplate();
    const items = (menu) => menu.submenu.filter((item) => item.type !== "separator");
    const [appMenu, fileMenu] = template;
    const themeMenu = template.find((item) => item.id === "themes");

    for (const item of [...items(appMenu), ...items(fileMenu), ...items(themeMenu)]) {
      if (item.role) {
        expect(item, item.role).not.toHaveProperty("icon");
      } else {
        expect(item.icon, item.id).toEqual({ symbolName: NATIVE_MENU_COMMAND_SYMBOLS[item.id] });
      }
    }
    expect(appMenu.submenu.find((item) => item.id === "app.settings").icon).toEqual({ symbolName: "gearshape" });
    expect(appMenu.submenu.find((item) => item.id === "app.checkForUpdates").icon)
      .toEqual({ symbolName: "arrow.triangle.2.circlepath" });
    // Theme choices are radio items: their checkmark takes the image column.
    expect(themeMenu.submenu[0].submenu.every((item) => !("icon" in item))).toBe(true);
    expect(service.createDockMenuTemplate().every((item) => !("icon" in item))).toBe(true);
  });

  it("keeps commands bare when the platform draws no menu symbols", () => {
    const { service } = createHarness({ menuSymbol: () => undefined });
    const appItems = service.createApplicationMenuTemplate()[0].submenu;
    expect(appItems.find((item) => item.id === "app.settings")).not.toHaveProperty("icon");
    expect(createHarness().service.createApplicationMenuTemplate()[0].submenu
      .find((item) => item.id === "app.checkForUpdates")).not.toHaveProperty("icon");
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
