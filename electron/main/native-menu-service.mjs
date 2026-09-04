const FALLBACK_SUB_THEME_ID = "default.neutral";

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
  onSelectTheme = () => undefined,
  onOpenThemesDirectory = () => undefined,
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
  if (typeof onSelectTheme !== "function") throw new TypeError("onSelectTheme must be a function.");
  if (typeof onOpenThemesDirectory !== "function") throw new TypeError("onOpenThemesDirectory must be a function.");

  let themeState = {
    pack: FALLBACK_SUB_THEME_ID,
    requiredTargets: ["application", "markdown", "csv"],
    themes: [{ id: FALLBACK_SUB_THEME_ID, name: "Neutral", targets: ["application", "markdown", "csv"] }],
  };

  const action = (actionId, handler) => () => runMenuAction(actionId, handler, logger);

  const createFileMenu = () => ({
    label: t("native.menu.file"),
    submenu: [
      {
        id: "file.newWindow",
        label: t("native.dock.newWindow"),
        accelerator: "CmdOrCtrl+N",
        click: action("file.newWindow", onNewWindow),
      },
      { type: "separator" },
      { role: "close" },
    ],
  });

  const createAppMenu = () => ({
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      {
        id: "app.checkForUpdates",
        label: t("native.menu.checkForUpdates"),
        click: action("app.checkForUpdates", onCheckForUpdates),
      },
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

  const createThemePackGroup = () => ({
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
      {
        id: "theme.openFolder",
        label: t("native.menu.theme.openFolder"),
        click: action("theme.openFolder", onOpenThemesDirectory),
      },
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
