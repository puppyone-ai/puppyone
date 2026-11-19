const FALLBACK_SUB_THEME_ID = "default.neutral";

/**
 * SF Symbols for the commands PuppyOne adds to its menus. AppKit decorates
 * the standard role commands itself from macOS 26; these give the custom
 * commands beside them the symbol a native app would use, so no menu mixes
 * decorated and bare rows. The platform decides whether symbols are drawn.
 */
export const NATIVE_MENU_COMMAND_SYMBOLS = Object.freeze({
  "app.checkForUpdates": "arrow.triangle.2.circlepath",
  "app.settings": "gearshape",
  "file.newWindow": "macwindow.badge.plus",
  "file.manageExecutions": "list.bullet.rectangle",
  "theme.pack": "paintpalette",
  "theme.openFolder": "folder",
});

function runMenuAction(actionId, action, logger) {
  void Promise.resolve()
    .then(action)
    .catch((error) => {
      logger.error(`Unable to run native menu action ${actionId}:`, error);
    });
}

export function createDesktopNativeMenuService({
  app,
  Menu,
  platform = process.platform,
  t,
  onNewWindow,
  onCheckForUpdates,
  onOpenSettings = () => undefined,
  onManageExecutions = () => undefined,
  onSelectTheme = () => undefined,
  onOpenThemesDirectory = () => undefined,
  menuSymbol = () => undefined,
  logger = console,
}) {
  if (!app) throw new TypeError("An Electron app is required.");
  if (!Menu || typeof Menu.buildFromTemplate !== "function") {
    throw new TypeError("The Electron Menu authority is required.");
  }
  if (typeof t !== "function") throw new TypeError("A native menu translator is required.");
  if (typeof onNewWindow !== "function") throw new TypeError("onNewWindow must be a function.");
  if (typeof onCheckForUpdates !== "function") {
    throw new TypeError("onCheckForUpdates must be a function.");
  }
  if (typeof onOpenSettings !== "function") throw new TypeError("onOpenSettings must be a function.");
  if (typeof onSelectTheme !== "function") throw new TypeError("onSelectTheme must be a function.");
  if (typeof onOpenThemesDirectory !== "function") throw new TypeError("onOpenThemesDirectory must be a function.");
  if (typeof menuSymbol !== "function") throw new TypeError("menuSymbol must be a function.");

  let themeState = {
    pack: FALLBACK_SUB_THEME_ID,
    requiredTargets: ["application", "markdown", "csv"],
    themes: [{ id: FALLBACK_SUB_THEME_ID, name: "Neutral", targets: ["application", "markdown", "csv"] }],
  };

  const action = (actionId, handler) => () => runMenuAction(actionId, handler, logger);
  const command = (item) => {
    const symbolName = NATIVE_MENU_COMMAND_SYMBOLS[item.id];
    const icon = symbolName ? menuSymbol(symbolName) : undefined;
    return icon ? { ...item, icon } : item;
  };

  const createFileMenu = () => ({
    label: t("native.menu.file"),
    submenu: [
      command({
        id: "file.newWindow",
        label: t("native.dock.newWindow"),
        accelerator: "CmdOrCtrl+N",
        click: action("file.newWindow", onNewWindow),
      }),
      { type: "separator" },
      command({ id: "file.manageExecutions", label: t("native.execution.title"),
        click: action("file.manageExecutions", onManageExecutions) }),
      { role: "close" },
    ],
  });

  const createAppMenu = () => ({
    label: app.name,
    submenu: [
      // About and Check for Updates are one group: both are about this build.
      { role: "about" },
      command({
        id: "app.checkForUpdates",
        label: t("native.menu.checkForUpdates"),
        click: action("app.checkForUpdates", onCheckForUpdates),
      }),
      { type: "separator" },
      command({
        id: "app.settings",
        label: t("native.menu.settings"),
        accelerator: "CmdOrCtrl+,",
        click: action("app.settings", onOpenSettings),
      }),
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  });

  const createThemePackGroup = () => command({
    id: "theme.pack",
    label: t("native.menu.theme.pack"),
    submenu: themeState.themes
      .filter((theme) => (
        theme.id !== "local.puppyone.custom-css"
        && themeState.requiredTargets.every((target) => theme.targets.includes(target))
      ))
      .map((theme) => ({
        id: `theme.pack.${theme.id}`,
        label: theme.name,
        type: "radio",
        checked: themeState.pack === theme.id,
        click: action(`theme.pack.${theme.id}`, () => (
          onSelectTheme({ kind: "pack", themeId: theme.id })
        )),
      })),
  });

  const createThemeMenu = () => ({
    id: "themes",
    label: t("native.menu.theme"),
    submenu: [
      createThemePackGroup(),
      { type: "separator" },
      command({
        id: "theme.openFolder",
        label: t("native.menu.theme.openFolder"),
        click: action("theme.openFolder", onOpenThemesDirectory),
      }),
    ],
  });

  const createApplicationMenuTemplate = () => [
    createAppMenu(),
    createFileMenu(),
    { role: "editMenu" },
    { role: "viewMenu" },
    createThemeMenu(),
    { role: "windowMenu" },
    { role: "help" },
  ];

  const createDockMenuTemplate = () => [
    {
      id: "dock.newWindow",
      label: t("native.dock.newWindow"),
      click: action("dock.newWindow", onNewWindow),
    },
  ];

  const refresh = () => {
    if (platform !== "darwin") return { supported: false };

    const applicationMenu = Menu.buildFromTemplate(createApplicationMenuTemplate());
    Menu.setApplicationMenu(applicationMenu);

    if (app.dock && typeof app.dock.setMenu === "function") {
      app.dock.setMenu(Menu.buildFromTemplate(createDockMenuTemplate()));
    }

    return { supported: true };
  };

  const setThemeState = (nextState) => {
    themeState = normalizeThemeState(nextState);
    refresh();
  };

  return Object.freeze({
    createApplicationMenuTemplate,
    createDockMenuTemplate,
    refresh,
    setThemeState,
  });
}

function normalizeThemeState(value) {
  const validTargets = new Set(["application", "typography", "markdown", "csv"]);
  const defaultRequiredTargets = ["application", "markdown", "csv"];
  const requiredTargets = Array.isArray(value?.requiredTargets)
    ? value.requiredTargets.filter((target) => validTargets.has(target))
    : defaultRequiredTargets;
  const pack = normalizePackId(value?.pack);
  const themes = Array.isArray(value?.themes)
    ? value.themes.flatMap((theme) => {
      if (typeof theme?.id !== "string" || typeof theme?.name !== "string") return [];
      const targets = Array.isArray(theme.targets)
        ? theme.targets.filter((target) => validTargets.has(target))
        : [];
      return targets.length > 0
        ? [{ id: theme.id, name: theme.name, targets }]
        : [];
    })
    : [];
  return { pack, requiredTargets, themes };
}

function normalizePackId(value) {
  if (value === "default") return FALLBACK_SUB_THEME_ID;
  return typeof value === "string" ? value : FALLBACK_SUB_THEME_ID;
}
