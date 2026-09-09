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
  onMarkdownCommand = () => undefined,
  isMarkdownEditorActive = () => false,
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
  if (typeof onMarkdownCommand !== "function") throw new TypeError("onMarkdownCommand must be a function.");
  if (typeof isMarkdownEditorActive !== "function") throw new TypeError("isMarkdownEditorActive must be a function.");
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

  const markdownAction = (command) => action(`markdown.${command}`, () => onMarkdownCommand(command));
  const markdownItem = (command, messageId, accelerator) => ({
    id: `markdown.${command}`,
    label: t(messageId),
    enabled: isMarkdownEditorActive(),
    ...(accelerator ? { accelerator } : {}),
    click: markdownAction(command),
  });

  const createFormatMenu = () => ({
    id: "format",
    label: t("native.menu.format"),
    enabled: isMarkdownEditorActive(),
    submenu: [
      {
        id: "format.text-style",
        label: t("native.menu.format.textStyle"),
        enabled: isMarkdownEditorActive(),
        submenu: [
          markdownItem("strong", "native.menu.format.strong", "CmdOrCtrl+B"),
          markdownItem("emphasis", "native.menu.format.emphasis", "CmdOrCtrl+I"),
          markdownItem("underline", "native.menu.format.underline", "CmdOrCtrl+U"),
          markdownItem("strike", "native.menu.format.strike", "CmdOrCtrl+Shift+X"),
          markdownItem("highlight", "native.menu.format.highlight", "CmdOrCtrl+Shift+H"),
          { type: "separator" },
          markdownItem("inline-code", "native.menu.format.inlineCode", "CmdOrCtrl+E"),
          markdownItem("inline-math", "native.menu.format.inlineMath"),
          markdownItem("link", "native.menu.format.link", "CmdOrCtrl+K"),
        ],
      },
      {
        id: "format.paragraph-style",
        label: t("native.menu.format.paragraphStyle"),
        enabled: isMarkdownEditorActive(),
        submenu: [
          markdownItem("paragraph", "native.menu.paragraph.text"),
          { type: "separator" },
          ...([1, 2, 3, 4, 5, 6].map((level) => (
            markdownItem(`heading-${level}`, `native.menu.paragraph.heading${level}`, `CmdOrCtrl+${level}`)
          ))),
          { type: "separator" },
          markdownItem("quote", "native.menu.paragraph.quote", "CmdOrCtrl+Shift+."),
          markdownItem("code-block", "native.menu.paragraph.codeBlock"),
          markdownItem("math-block", "native.menu.paragraph.mathBlock"),
        ],
      },
      {
        id: "format.list",
        label: t("native.menu.format.list"),
        enabled: isMarkdownEditorActive(),
        submenu: [
          markdownItem("bullet-list", "native.menu.paragraph.bulletList", "CmdOrCtrl+Shift+8"),
          markdownItem("ordered-list", "native.menu.paragraph.orderedList", "CmdOrCtrl+Shift+7"),
          markdownItem("task-list", "native.menu.paragraph.taskList", "CmdOrCtrl+Shift+9"),
        ],
      },
      { type: "separator" },
      markdownItem("outdent", "native.menu.paragraph.outdent", "CmdOrCtrl+["),
      markdownItem("indent", "native.menu.paragraph.indent", "CmdOrCtrl+]"),
      { type: "separator" },
      markdownItem("clear-format", "native.menu.format.clear", "CmdOrCtrl+\\"),
    ],
  });

  const createApplicationMenuTemplate = () => [
    createAppMenu(),
    createFileMenu(),
    { role: "editMenu" },
    createFormatMenu(),
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
