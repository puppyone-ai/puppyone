import vm from "node:vm";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_INTERFACE_STYLE,
  INTERFACE_STYLES,
  getInterfaceStyleDefinition,
  getInterfaceStyleFirstPaint,
  getInterfaceStyleThemeModes,
  parseInterfaceStyle,
  resolveActiveThemeMode,
  supportsThemePreset,
} from "../../../../src/features/appearance/interfaceStyles";
import { BUILTIN_SUB_THEMES } from "../../../../src/features/themes/builtinSubThemes";

describe("Interface style registry", () => {
  it("owns every style id and safely parses persisted values", () => {
    expect(DEFAULT_INTERFACE_STYLE).toBe("default");
    expect(new Set(INTERFACE_STYLES.map((style) => style.id)).size).toBe(INTERFACE_STYLES.length);
    for (const style of INTERFACE_STYLES) expect(parseInterfaceStyle(style.id)).toBe(style.id);
    expect(parseInterfaceStyle("windows-7")).toBe(DEFAULT_INTERFACE_STYLE);
    expect(parseInterfaceStyle(null)).toBe(DEFAULT_INTERFACE_STYLE);
  });

  it("derives color controls and active modes from palette capabilities", () => {
    expect(getInterfaceStyleThemeModes("default")).toEqual(["system", "light", "dark"]);
    expect(supportsThemePreset("default", "light")).toBe(true);
    expect(supportsThemePreset("default", "dark")).toBe(true);
    expect(resolveActiveThemeMode("default", "system")).toBe("system");
    expect(resolveActiveThemeMode("default", "dark")).toBe("dark");

    for (const style of INTERFACE_STYLES.filter(({ palette }) => palette.kind === "fixed")) {
      expect(getInterfaceStyleThemeModes(style.id)).toEqual([]);
      expect(supportsThemePreset(style.id, "light")).toBe(false);
      expect(supportsThemePreset(style.id, "dark")).toBe(false);
      expect(resolveActiveThemeMode(style.id, "system")).toBe(style.palette.mode);
      expect(resolveActiveThemeMode(style.id, "dark")).toBe(style.palette.mode);
    }
  });

  it("uses the same generated manifest for first paint and the React runtime", () => {
    const bootstrap = source("public/interface-style-bootstrap.js");
    const subThemeBootstrap = source("public/sub-theme-bootstrap.js");
    const initialTheme = source("public/initial-theme.js");
    const index = source("index.html");
    const bootstrapIndex = index.indexOf('/interface-style-bootstrap.js');
    const subThemeBootstrapIndex = index.indexOf('/sub-theme-bootstrap.js');
    const resolverIndex = index.indexOf('/initial-theme.js');

    expect(bootstrapIndex).toBeGreaterThan(0);
    expect(subThemeBootstrapIndex).toBeGreaterThan(bootstrapIndex);
    expect(resolverIndex).toBeGreaterThan(subThemeBootstrapIndex);
    expect(initialTheme).not.toContain('"windows-xp"');
    expect(initialTheme).not.toContain("editorPresentation");

    for (const style of INTERFACE_STYLES) {
      const requestedMode = "dark";
      const activeMode = resolveActiveThemeMode(style.id, requestedMode);
      const resolvedTheme = activeMode === "system" ? "dark" : activeMode;
      const defaultSubThemeId = style.subThemes.defaultSubThemeIds[resolvedTheme];
      const subTheme = BUILTIN_SUB_THEMES.find(({ id }) => id === defaultSubThemeId);
      const expectedPaint = getInterfaceStyleFirstPaint(style.id, resolvedTheme, subTheme);
      const result = runFirstPaint({
        bootstrap,
        subThemeBootstrap,
        initialTheme,
        interfaceStyle: style.id,
        themeMode: requestedMode,
        systemDark: true,
      });

      expect(result.dataset.interfaceStyle).toBe(style.id);
      expect(result.dataset.interfaceStyleFamily).toBe(style.profile.family);
      expect(result.dataset.interfaceStyleVariant).toBe(style.profile.variant);
      expect(result.dataset.interfaceStylePalette).toBe(style.profile.palette);
      expect(result.dataset).not.toHaveProperty("editorPresentation");
      expect(result.dataset.initialTheme).toBe(resolvedTheme);
      expect(result.properties["--initial-shell-background"]).toBe(expectedPaint.background);
      expect(result.properties["--initial-shell-color-scheme"]).toBe(expectedPaint.colorScheme);
    }
  });

  it("keeps the native window underlay on the generated first-paint contract", () => {
    const main = source("electron/main.mjs");
    const preload = source("electron/preload.cjs");
    const nativeFirstPaint = source("electron/main/sub-theme-first-paint.generated.mjs");

    expect(main).toContain("FALLBACK_SUB_THEME_FIRST_PAINT");
    expect(main).not.toContain('backgroundColor: "#f1eadf"');
    expect(preload).toContain('ipcRenderer.send("appearance:set-window-background"');
    expect(nativeFirstPaint).toContain('"background": "#fafafa"');
    expect(nativeFirstPaint).toContain('"background": "#161413"');
  });

  it("uses Neutral as the attribute-free fallback and packages Warm independently", () => {
    const tokens = source("src/styles/tokens.css");
    const fallback = source("src/styles/fallback-theme.generated.css");
    const warm = source("sub-themes/default-warm/theme.css");

    expect(fallback).toContain("--po-surface-panel: #fafafa");
    expect(fallback).toContain("--po-header: #ebebeb;");
    expect(fallback).toContain("--po-sidebar: #ebebeb;");
    expect(tokens).not.toContain("--po-surface-panel: #fafafa");
    expect(tokens).not.toContain("--po-header: #ebebeb;");
    expect(warm).toContain("--po-surface-panel: #fbfaf7;");
    expect(warm).toContain("--po-header: #f1eee8;");
    expect(warm).toContain("--po-sidebar: #f1eee8;");
    expect(tokens).not.toContain("#f1eadf");
    expect(tokens).not.toContain("#fbf6ed");
    expect(tokens).not.toContain("data-light-theme-preset=");
    expect(warm).toContain("@puppyone application");
  });

  it("paints the persisted editor palette before React instead of flashing the warm fallback", () => {
    const bootstrap = source("public/interface-style-bootstrap.js");
    const subThemeBootstrap = source("public/sub-theme-bootstrap.js");
    const initialTheme = source("public/initial-theme.js");
    const initialShell = source("public/initial-shell.css");
    const cases = [
      { themeMode: "light", preset: "neutral", subThemeId: "default.neutral", expected: "#fafafa" },
      { themeMode: "light", preset: "warm", subThemeId: "default.warm", expected: "#fbfaf7" },
      { themeMode: "light", preset: "graphite", subThemeId: "default.graphite", expected: "#fbfbfc" },
      { themeMode: "dark", preset: "default", subThemeId: "default.neutral", expected: "#161413" },
      { themeMode: "dark", preset: "warm", subThemeId: "default.warm", expected: "#18130f" },
      { themeMode: "dark", preset: "graphite", subThemeId: "default.graphite", expected: "#17181c" },
    ] as const;

    expect(initialShell).toContain("--initial-shell-background: #fafafa");
    expect(initialShell).not.toContain("--initial-shell-background: #f1eadf");

    for (const item of cases) {
      const result = runFirstPaint({
        bootstrap,
        subThemeBootstrap,
        initialTheme,
        interfaceStyle: "default",
        themeMode: item.themeMode,
        lightThemePreset: item.themeMode === "light" ? item.preset : undefined,
        darkThemePreset: item.themeMode === "dark" ? item.preset : undefined,
        systemDark: false,
      });
      expect(result.dataset.initialSubThemeId).toBe(item.subThemeId);
      expect(result.properties["--initial-shell-background"]).toBe(item.expected);
      expect(result.nativeBackgrounds).toEqual([item.expected]);
      expect(result.nativeThemeSources).toEqual([item.themeMode]);
      const subTheme = BUILTIN_SUB_THEMES.find(({ id }) => id === item.subThemeId);
      expect(getInterfaceStyleFirstPaint("default", item.themeMode, subTheme).background)
        .toBe(item.expected);
    }

    const defaultLight = runFirstPaint({
      bootstrap,
      subThemeBootstrap,
      initialTheme,
      interfaceStyle: "default",
      themeMode: "light",
      systemDark: false,
    });
    expect(defaultLight.dataset.initialSubThemeId).toBe("default.neutral");
    expect(defaultLight.properties["--initial-shell-background"]).toBe("#fafafa");

    const systemLight = runFirstPaint({
      bootstrap,
      subThemeBootstrap,
      initialTheme,
      interfaceStyle: "default",
      themeMode: "system",
      systemDark: false,
    });
    expect(systemLight.nativeThemeSources).toEqual(["system"]);

    const invalidPreset = runFirstPaint({
      bootstrap,
      subThemeBootstrap,
      initialTheme,
      interfaceStyle: "default",
      themeMode: "light",
      lightThemePreset: "__proto__",
      systemDark: false,
    });
    expect(invalidPreset.dataset.initialSubThemeId).toBe("default.neutral");
    expect(invalidPreset.properties["--initial-shell-background"]).toBe("#fafafa");

    const v5Selection = runFirstPaint({
      bootstrap,
      subThemeBootstrap,
      initialTheme,
      interfaceStyle: "default",
      themeMode: "light",
      appearancePreferences: JSON.stringify({
        schemaVersion: 5,
        activeRootThemeId: "default",
        byRootTheme: {
          default: {
            requestedColorMode: "dark",
            requestedSubThemeIds: { light: "default.github", dark: "default.github" },
          },
        },
      }),
      systemDark: false,
    });
    expect(v5Selection.dataset.initialSubThemeId).toBe("default.github");
    expect(v5Selection.properties["--initial-shell-background"]).toBe("#0d1117");

    const damagedSelection = runFirstPaint({
      bootstrap,
      subThemeBootstrap,
      initialTheme,
      interfaceStyle: "default",
      themeMode: "light",
      appearancePreferences: JSON.stringify({
        schemaVersion: 4,
        activeRootThemeId: "default",
        byRootTheme: {
          default: {
            requestedColorMode: "light",
            requestedSubThemeIds: { light: "local.broken", dark: "local.broken" },
          },
        },
      }),
      systemDark: false,
    });
    expect(damagedSelection.dataset.initialSubThemeId).toBe("local.broken");
    expect(damagedSelection.properties["--initial-shell-background"]).toBe("#fafafa");
  });

  it("honors the legacy light-preset key during first-paint migration", () => {
    const result = runFirstPaint({
      bootstrap: source("public/interface-style-bootstrap.js"),
      subThemeBootstrap: source("public/sub-theme-bootstrap.js"),
      initialTheme: source("public/initial-theme.js"),
      interfaceStyle: "default",
      themeMode: "light",
      legacyThemePreset: "warm",
      systemDark: false,
    });

    expect(result.dataset.initialSubThemeId).toBe("default.warm");
    expect(result.properties["--initial-shell-background"]).toBe("#fbfaf7");
  });

  it("generates deterministic skin imports and enforces one shared component contract", () => {
    const appEntry = source("src/styles.css").trim();
    const skinEntry = source("src/styles/interface-styles.generated.css").trim();
    const contract = source("src/styles/interface-skin-contract.css");

    expect(appEntry.endsWith('@import "./styles/interface-styles.generated.css";')).toBe(true);
    expect(skinEntry).toContain('@import "./interface-skin-contract.css" layer(interface-style);');
    expect(contract).toContain(':root[data-interface-style]:not([data-interface-style="default"])');
    for (const selector of [
      ".desktop-titlebar",
      ".desktop-explorer-toolbar",
      ".desktop-menu-surface",
      ".desktop-dialog-footer",
      ".desktop-settings-switch",
      "::-webkit-scrollbar",
    ]) {
      expect(contract, selector).toContain(selector);
    }

    for (const style of INTERFACE_STYLES) {
      if (style.stylesheet === null) continue;
      expect(skinEntry).toContain(`@import "./${style.stylesheet}" layer(interface-style);`);
      const skin = style.id === "windows-xp"
        ? windowsXpStylePack()
        : source(`src/styles/${style.stylesheet}`);
      expect(skin).toContain(`:root[data-interface-style="${style.id}"]`);
      expect(skin).toContain("--interface-titlebar-control-border:");
      expect(skin).toContain("--interface-settings-list-background:");
    }
  });

  it("retains the historically specific XP treatment", () => {
    const xp = windowsXpStylePack();
    expect(xp).toContain("--xp-titlebar-start:");
    expect(xp).toContain("--xp-button-hover-start:");
    expect(xp).toContain("--xp-titlebar-background-image:");
    expect(xp).toMatch(
      /\.desktop-titlebar\s*\{[^}]*background-image:\s*var\(--xp-titlebar-background-image\)/s,
    );
    expect(xp).toMatch(
      /\.desktop-dialog-header\s*\{[^}]*min-height:\s*var\(--desktop-chrome-height\);[^}]*background-image:\s*var\(--xp-titlebar-background-image\)/s,
    );
    expect(xp).toMatch(
      /\.desktop-dialog-header \.desktop-dialog-icon-button\s*\{[^}]*var\(--xp-window-control-close-image\)/s,
    );
    expect(xp).toMatch(
      /\.desktop-dialog-header \.desktop-dialog-icon-button::before\s*\{[^}]*inset:\s*0;[^}]*var\(--desktop-dialog-caption-close-image\)[^}]*100% 100%/s,
    );
    expect(xp).toMatch(
      /\.desktop-dialog-header \.desktop-dialog-icon-button:hover:not\(:disabled\)\s*\{[^}]*--desktop-dialog-caption-close-image:\s*var\(--xp-window-control-close-hover-image\)/s,
    );
  });

  it("keeps Luna paint authentic and delegates structure to the profile", () => {
    const xp = windowsXpStylePack();
    const dataWorkspaceSurface = source("src/features/app-shell/DesktopDataWorkspaceSurface.tsx");
    const visualHarness = source("src/features/appearance/AppearanceVisualSmokeHarness.tsx");
    const visualSmoke = source("tests/integration/appearance/themes/appearance-visual-matrix.smoke.mjs");
    const explorer = source("packages/shared-ui/src/data/ExplorerTree.tsx");
    const xpExplorerCss = source("src/styles/interfaces/windows-xp/features/explorer.css");
    const profile = getInterfaceStyleDefinition("windows-xp");
    const toolbarCss = xp.slice(
      xp.indexOf("/* Explorer command band"),
      xp.indexOf("/* The window frame already supplies"),
    );

    expect(xp).toContain("--xp-titlebar-mid: #0757d7;");
    expect(xp).toContain("linear-gradient(90deg, rgba(255, 255, 255, 0.08)");
    expect(xp).toContain("var(--xp-titlebar-top) 5%");
    expect(xp).toContain("var(--xp-titlebar-edge) 100%");
    expect(xp).not.toContain("window-titlebar-active.svg");
    expect(xp).not.toContain("background-repeat: repeat-x;");
    expect(xp).toMatch(
      /\.desktop-window-control\.is-minimize\s*\{[^}]*var\(--xp-window-control-minimize-image\)/s,
    );
    expect(xp).toMatch(
      /\.desktop-window-control\.is-maximize\s*\{[^}]*var\(--xp-window-control-maximize-image\)/s,
    );
    expect(xp).toMatch(
      /\.desktop-window-control\.is-close\s*\{[^}]*var\(--xp-window-control-close-image\)/s,
    );
    expect(xp).not.toContain(".desktop-window-control.is-close span::before");
    expect(xp).toContain("--xp-toolbar-mid: #f0ede0;");
    expect(xp).toContain("--xp-pane-caption-end: #0a59cc;");
    expect(xp).toContain("--xp-scroll-thumb-mid: #c4d3f8;");
    expect(xp).toContain("--po-surface-chrome: #ece9d8;");
    expect(xp).toContain("--po-text: #303236;");
    expect(xp).toContain("--po-text-muted: #5f6368;");
    expect(xp).toContain("--po-text-subtle: #7a7e84;");
    expect(xp).toContain("--po-text-disabled: #a2a5aa;");
    expect(xp).toContain("--po-tree-row-selected-bg: #316ac5;");
    expect(xp).toContain("--po-tree-row-selected-muted-bg: #d4d0c8;");
    expect(xp).toContain("--po-shell-divider: #c9c7be;");
    expect(xp).toContain("--po-font-sans: Tahoma");
    expect(xp).toContain(".tree-icon-slot:has(.tree-disclosure-marker[data-expanded=\"true\"])");
    expect(xp).toContain(":where(.tree-row.folder, .tree-row.root) .tree-label::before");
    expect(xp).toContain('url("../assets/explorer-folder-closed.svg")');
    expect(xp).toContain('url("../assets/explorer-folder-open.svg")');
    expect(xp).toContain('url("../assets/explorer-file-generic.svg?inline")');
    expect(xp).toContain('url("../assets/explorer-file-html.svg?inline")');
    expect(xp).toContain('url("../assets/explorer-file-image.svg?inline")');
    expect(xp).toContain("--xp-tree-dot-step: 4px;");
    expect(xp).toContain(".explorer-tree-motion-shell:not([data-depth=\"0\"])::after");
    expect(xpExplorerCss).toContain(
      ".explorer-tree-shell .tree-row.file .tree-icon-slot",
    );
    expect(xpExplorerCss).toMatch(
      /\.explorer-tree-shell \.tree-row\.file \.tree-icon-slot\s*\{[^}]*explorer-file-generic\.svg\?inline/s,
    );
    expect(
      xpExplorerCss.match(/explorer-file-[a-z-]+\.svg\?inline/g),
    ).toHaveLength(8);
    expect(xp).toContain("--po-tree-guide: #808080;");
    expect(xpExplorerCss).not.toMatch(
      /:root\[data-interface-style="windows-xp"\]\s+(?:\.tree-row|\.tree-icon-slot|\.tree-disclosure-marker)/,
    );
    expect(xp).toContain(".explorer-tree-scroll:focus-within .tree-row:is(.selected, .active)");
    expect(xp).toContain(":where(.tree-label-primary, .tree-label-extension)");
    expect(xp).not.toContain("url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 16'");
    expect(visualHarness).toContain("<ExplorerTree");
    expect(visualHarness).not.toContain("appearance-visual-tree-glyph");
    expect(xp).toContain(".desktop-sidebar-footer-button.active");
    expect(xp).toContain(".desktop-shell-navigation-toolbar-actions");
    expect(visualHarness).toContain('data-toolbar-action="terminal"');
    expect(visualHarness).not.toContain('data-toolbar-action="agent"');
    expect(visualSmoke).toContain('JSON.stringify(["terminal"])');
    expect(visualSmoke).toContain('JSON.stringify(["Terminal"])');
    expect(visualSmoke).not.toContain('JSON.stringify(["Chat", "Agent"])');
    expect(xp).toContain('.app-shell[data-location-bar-composition="workspace-path-v1"]');
    expect(xp).toContain(".desktop-shell-location-bar-field");
    expect(xp).toContain(".desktop-shell-location-bar-dropdown");
    expect(xp).toContain("--interface-directional-arrow-size: 7px;");
    expect(xp).toContain("viewBox='0 0 7 7' shape-rendering='crispEdges'");
    expect(xp).toMatch(
      /\.desktop-shell-location-bar-dropdown\s*\{[^}]*var\(--interface-scrollbar-button-down-image\)[^}]*var\(--interface-directional-arrow-size\)/s,
    );
    expect(xp).toMatch(/\.desktop-shell-location-bar-dropdown::before\s*\{[^}]*content:\s*none;/s);
    expect(xp).toContain(".desktop-shell-location-bar-go-icon");
    expect(xp).not.toContain(".desktop-shell-location-bar::before");
    expect(xp).toContain(".desktop-shell-location-bar-value:focus");
    expect(xp).toContain("height: 24px;");
    expect(xp).toContain("border: 1px solid #7f9db9;");
    expect(xp).toContain("--interface-scrollbar-button-background-image:");
    expect(xp).toContain("height: 56px;");
    expect(xp).toContain("--interface-shell-toolbar-button-hover-border-color: var(--xp-default-ring);");
    expect(xp).toContain("--interface-shell-toolbar-button-checked-border-color: #7f9db9;");
    expect(xp).toContain("--interface-shell-toolbar-button-pressed-border-color: var(--xp-selection);");
    expect(toolbarCss).toContain(":where(:not(.active):not([aria-current=\"page\"]):not([aria-pressed=\"true\"]))");
    expect(toolbarCss).toContain(":is(.active, [aria-current=\"page\"], [aria-pressed=\"true\"])");
    expect(toolbarCss).toContain(".desktop-shell-toolbar-menu-trigger[aria-expanded=\"true\"]");
    expect(toolbarCss).not.toContain("#c98518");
    expect(toolbarCss).not.toContain("#efd080");
    expect(xp).not.toContain("inset 0 -2px 0 #ef921c");
    expect(xp).toMatch(
      /\.desktop-shell-navigation-toolbar-host\s*\{[^}]*background:\s*#f5f4ee;[^}]*box-shadow:\s*none;/s,
    );
    expect(xp).toMatch(
      /\.desktop-shell-location-bar-host\s*\{[^}]*border:\s*0;[^}]*background:\s*#f5f4ee;[^}]*box-shadow:\s*none;/s,
    );
    expect(xp).toContain(".desktop-shell-location-bar-host::before");
    expect(xp).toContain(".desktop-shell-location-bar-host::after");
    expect(xp).toContain("background: #d8d5cb;");
    expect(xp).toContain("background: #c8c5bb;");
    expect(xp).toMatch(/\.desktop-shell-body\s*\{[^}]*padding:\s*0;[^}]*gap:\s*0;/s);
    expect(xp).toMatch(/\.desktop-surface\s*\{[^}]*border:\s*0;/s);
    expect(xp).toMatch(/\.data-explorer-resizer::after\s*\{[^}]*background:\s*var\(--po-shell-divider\);/s);
    expect(toolbarCss).toContain(".desktop-shell-toolbar-button");
    expect(toolbarCss).not.toContain(".desktop-titlebar-action");
    expect(toolbarCss).not.toContain(".desktop-sidebar-top-navigation-button");
    expect(toolbarCss).not.toMatch(/\.(?:cm-|markdown-codemirror-editor|csv-table-editor|desktop-terminal-xterm)/);
    expect(profile.composition.iconPack).toBe("windows-xp-native-v1");
    expect(toolbarCss).toContain('.app-shell[data-icon-pack="windows-xp-native-v1"]');
    for (const asset of [
      "toolbar-files-skeuomorphic.png",
      "toolbar-git-gitg-classic.png",
      "toolbar-settings-system.png",
      "toolbar-cloud-skeuomorphic.png",
      "toolbar-terminal-skeuomorphic.png",
    ]) {
      expect(toolbarCss, asset).toContain(`url("./assets/${asset}")`);
    }
    expect(source("src/styles/interfaces/windows-xp/assets/B00MERANG-WINDOWS-XP-GPL-2.0.txt"))
      .toContain("GNU GENERAL PUBLIC LICENSE");
    expect(source("src/styles/interfaces/windows-xp/assets/B00MERANG-WINDOWS-XP-THEME-GPL-3.0.txt"))
      .toContain("Version 3, 29 June 2007");
    const lunaDecorationHashes = {
      "window-control-minimize.svg": "73aa3d6afe492bed989143f154e09c3adb86e96fc9e78cb59ae907a6608d35a6",
      "window-control-minimize-hover.svg": "f38529dcbc78e34afc590cc46b5fb4d431ef92b63594bec51e7113eebec0d2ab",
      "window-control-minimize-active.svg": "e0464aa1e6f3e6b07b199779732ff3004f2c5070efd8c71b2c159907befdb9d2",
      "window-control-maximize.svg": "f3d473e593288c17da48f8ad638b9ddce07ebdbfe0103fb9c83819d5c3b8e51f",
      "window-control-maximize-hover.svg": "9b6057b2239502a99a8c82c15bf170dca3bb6553a95a6dd89db0aaed36d12464",
      "window-control-maximize-active.svg": "0f8bc658383ac4f49925c161e71e5faa073218e8cc9c43485873f6996df35b0b",
      "window-control-close.svg": "20cf76d86c894f600f0f64f97471405393de05e5211213bca063cb30401f348d",
      "window-control-close-hover.svg": "54b02ee927e755945e356abbd05a6f427ce291de62114fbcd0ab4f2c0ab6de8b",
      "window-control-close-active.svg": "5d9bdfc19c9d0814d1c6df1926152a8eb1ab4af471f7121ade7ffc575e4e829a",
    } as const;
    for (const [asset, expectedHash] of Object.entries(lunaDecorationHashes)) {
      const assetSource = source(`src/styles/interfaces/windows-xp/assets/${asset}`);
      expect(assetSource, asset).toContain("7637830906823af40a3cd7e7079be753d8b7d679");
      expect(assetSource, asset).toContain('image-rendering="auto"');
      const payload = assetSource.match(/base64,([^"']+)/)?.[1];
      expect(payload, asset).toBeTruthy();
      expect(createHash("sha256").update(Buffer.from(payload!, "base64")).digest("hex"), asset)
        .toBe(expectedHash);
    }
    expect(source("src/styles/interfaces/windows-xp/assets/CRYSTAL-CLEAR-LGPL-2.1.txt"))
      .toContain("GNU LESSER GENERAL PUBLIC LICENSE");
    expect(source("THIRD_PARTY_NOTICES.md"))
      .toContain("B00merang Windows-XP icon theme");
    expect(source("THIRD_PARTY_NOTICES.md"))
      .toContain("B00merang Windows-XP Luna caption buttons");
    expect(source("THIRD_PARTY_NOTICES.md"))
      .toContain("places/gtk-directory.png");
    expect(source("THIRD_PARTY_NOTICES.md"))
      .toContain("Git official logomark");
    expect(source("THIRD_PARTY_NOTICES.md"))
      .toContain("GNOME gitg classic icon");
    expect(source("THIRD_PARTY_NOTICES.md"))
      .toContain("Crystal Clear configure icon");
    expect(xp).not.toContain("desktop-explorer-pane-caption");
    expect(dataWorkspaceSurface).toContain(
      "showExplorerToolbar={!shellHostedTopNavigation && Boolean(topNavigation)}",
    );
    expect(dataWorkspaceSurface).not.toContain("desktop-explorer-pane-caption");
    expect(visualHarness).not.toContain("desktop-explorer-pane-caption");
    expect(xp).toContain(".desktop-dialog-header .desktop-dialog-icon-button");
    expect(xp).toContain("--po-surface-editable-table-radius: 0px;");
    expect(explorer).toContain('data-expanded={expanded ? "true" : "false"}');
    expect(explorer).toContain("data-file-kind={isFolder ? undefined : getFileVisualKind");
    expect(xp).not.toMatch(/grid-template-columns|--data-explorer-width|--desktop-right-sidebar-width/);
    expect(profile.composition.navigation).toBe("sidebar-top-toolbar");
    expect(profile.composition.locationBar).toBe("workspace-path-v1");
    expect(profile.policies.sidebarNavigationLayout).toMatchObject({
      mode: "force",
      value: "top-horizontal",
    });
  });

  it("keeps historical scrollbar geometry and arrow buttons style-dependent", () => {
    const contract = source("src/styles/interface-skin-contract.css");
    const xp = windowsXpStylePack();
    const explorer = source("packages/shared-ui/src/data/ExplorerTree.tsx");
    const scrollbarActivity = source("src/components/ScrollbarActivity.tsx");
    const layout = source("src/styles/layout.css");
    const terminalSession = source(
      "src/features/desktop-terminal/ui/TerminalSessionView.tsx",
    );
    const terminalCss = source("src/features/desktop-terminal/ui/styles/terminal-surface.css")
      + source("src/features/desktop-terminal/ui/styles/xterm-adapter.css");
    const fallbackArrows = ["up", "down", "left", "right"].map((direction) => (
      source(`src/styles/interfaces/windows-xp/assets/scrollbar-${direction}.svg`)
    ));

    expect(contract).toContain("::-webkit-scrollbar-button:single-button");
    expect(contract).toContain("var(--interface-scrollbar-thumb-background)");
    expect(contract).toContain("var(--interface-scrollbar-button-display)");
    expect(contract).toContain('[data-scrollbar-composition="windows-xp-classic-v1"]');
    expect(xp).toContain("--po-scrollbar-size: 17px;");
    expect(xp).toContain("--desktop-sidebar-row-right-gap: 17px;");
    expect(xp).toContain("--interface-scrollbar-button-display: block;");
    expect(xp).toContain("--interface-scrollbar-button-size: 17px;");
    expect(xp).toContain("--interface-directional-arrow-size: 7px;");
    expect(xp).toContain("--interface-scrollbar-button-border-color: #b3bfd6;");
    expect(xp).toContain("--interface-scrollbar-background: #f7f5ef;");
    expect(xp).toContain("--interface-scrollbar-track-background: linear-gradient(90deg");
    expect(xp).toContain("--interface-scrollbar-track-background-horizontal: linear-gradient(180deg");
    expect(xp).toContain("--interface-scrollbar-thumb-background-horizontal:");
    expect(xp).toContain("--interface-scrollbar-button-background-image-horizontal: linear-gradient(180deg");
    expect(xp).not.toContain("--interface-scrollbar-track-background: repeating-conic-gradient");
    expect(xp).toContain("--interface-scrollbar-button-hover-background-color: #bfcef4;");
    expect(xp).not.toContain(".po-classic-scrollbar");
    expect(xp).not.toContain(".desktop-terminal");
    expect(xp).not.toContain("--interface-scrollbar-button-hover-background-color: #fff4ce;");
    expect(xp).not.toContain("--interface-scrollbar-button-hover-border-color: var(--xp-default-ring);");
    expect(xp).toContain("--interface-terminal-classic-scrollbar-display: block;");
    expect(xp).toContain("--interface-terminal-native-scrollbar-opacity: 0;");
    expect(scrollbarActivity).toContain("HISTORICAL_SCROLLBAR_COMPOSITION");
    expect(scrollbarActivity).toContain("HISTORICAL_SCROLLBAR_PRESENTATION_TOKENS");
    expect(scrollbarActivity).toContain("createPortal(");
    expect(scrollbarActivity).toContain("control.host");
    expect(scrollbarActivity).toContain("owner.scrollBy");
    expect(scrollbarActivity).toContain('data-scrollbar-orientation={control.orientation}');
    expect(scrollbarActivity).toContain("rect.height - (hasHorizontalOverflow ? scrollbarSize : 0)");
    expect(scrollbarActivity).toContain("rect.width - (hasVerticalOverflow ? scrollbarSize : 0)");
    expect(scrollbarActivity).not.toContain("position: fixed");
    expect(layout).toContain(".po-classic-scrollbar-controls");
    expect(layout).toContain("position: absolute;");
    expect(layout).toContain("z-index: 4;");
    expect(layout).not.toMatch(/\.po-classic-scrollbar-controls\s*\{[^}]*position:\s*fixed;/s);
    expect(layout).toContain(".po-classic-scrollbar-button");
    expect(layout).toContain("var(--interface-directional-arrow-size, 7px)");
    expect(layout).toContain("var(--interface-scrollbar-button-left-image, none)");
    expect(layout).toContain("var(--interface-scrollbar-button-right-image, none)");
    expect(terminalSession).toContain("desktop-terminal-classic-scrollbar-controls");
    expect(terminalSession).toContain("desktop-terminal-classic-scrollbar-button");
    expect(terminalSession).not.toContain("po-classic-scrollbar-button");
    expect(terminalCss).toContain("position: absolute;");
    expect(terminalCss).toContain("isolation: isolate;");
    expect(terminalCss).toContain("var(--interface-scrollbar-button-up-image, none)");
    expect(terminalCss).toContain("var(--interface-scrollbar-button-background-image, none)");
    expect(terminalCss).toContain("var(--interface-directional-arrow-size, 7px)");
    expect(contract).toContain("var(--interface-directional-arrow-size, 7px)");
    expect(contract).toContain("var(--interface-scrollbar-track-background-horizontal)");
    expect(contract).toContain("var(--interface-scrollbar-thumb-background-horizontal)");
    expect(contract).toContain("var(--interface-scrollbar-button-background-image-horizontal)");
    expect(new Set(fallbackArrows.map((asset) => (
      asset.match(/<path d="([^"]+)" fill="#566789"/)?.[1]
    ))).size).toBe(1);
    expect(fallbackArrows.every((asset) => asset.includes('shape-rendering="crispEdges"'))).toBe(true);
    expect(fallbackArrows[2]).toContain('x2="0" y2="1"');
    expect(fallbackArrows[3]).toContain('x2="0" y2="1"');
    expect(explorer).not.toContain("po-classic-scrollbar");
  });

  it("has a translated label for every registered style", () => {
    const localeManifest = JSON.parse(source("locales/manifest.json")) as {
      locales: Array<{ locale: string }>;
    };

    for (const { locale } of localeManifest.locales) {
      const catalog = JSON.parse(source(`locales/renderer/${locale}/settings.json`)) as Record<string, string>;
      for (const style of INTERFACE_STYLES) {
        const catalogKey = style.labelKey.replace(/^settings\./, "");
        expect(catalog[catalogKey], `${locale}: ${style.labelKey}`).toBeTruthy();
      }
      expect(catalog["appearance.theme.title"], locale).not.toBe(catalog["appearance.interfaceStyle.title"]);
    }
  });

  it("keeps every registry lookup total", () => {
    for (const style of INTERFACE_STYLES) {
      expect(getInterfaceStyleDefinition(style.id).id).toBe(style.id);
      const resolved = resolveActiveThemeMode(style.id, "system");
      const theme = resolved === "system" ? "light" : resolved;
      expect(getInterfaceStyleFirstPaint(style.id, theme).background).toMatch(/^#/);
    }
  });
});

function runFirstPaint({
  bootstrap,
  subThemeBootstrap,
  initialTheme,
  interfaceStyle,
  themeMode,
  lightThemePreset,
  darkThemePreset,
  legacyThemePreset,
  appearancePreferences,
  systemDark,
}: {
  bootstrap: string;
  subThemeBootstrap: string;
  initialTheme: string;
  interfaceStyle: string;
  themeMode: string;
  lightThemePreset?: string;
  darkThemePreset?: string;
  legacyThemePreset?: string;
  appearancePreferences?: string;
  systemDark: boolean;
}) {
  const dataset: Record<string, string> = {};
  const properties: Record<string, string> = {};
  const nativeBackgrounds: string[] = [];
  const nativeThemeSources: string[] = [];
  const values = new Map([
    ["puppyone.desktop.interfaceStyle", interfaceStyle],
    ["puppyone.desktop.theme", themeMode],
  ]);
  if (lightThemePreset) values.set("puppyone.desktop.lightThemePreset", lightThemePreset);
  if (darkThemePreset) values.set("puppyone.desktop.darkThemePreset", darkThemePreset);
  if (legacyThemePreset) values.set("puppyone.desktop.themePreset", legacyThemePreset);
  if (appearancePreferences) values.set("puppyone.desktop.appearance", appearancePreferences);
  const context = {
    window: {
      localStorage: { getItem: (key: string) => values.get(key) ?? null },
      matchMedia: () => ({ matches: systemDark }),
      puppyoneDesktop: {
        setWindowBackground: ({
          background,
          themeSource,
        }: {
          background: string;
          themeSource: string;
        }) => {
          nativeBackgrounds.push(background);
          nativeThemeSources.push(themeSource);
        },
      },
    },
    document: {
      documentElement: {
        dataset,
        style: { setProperty: (name: string, value: string) => { properties[name] = value; } },
      },
    },
  };
  vm.runInNewContext(bootstrap, context);
  vm.runInNewContext(subThemeBootstrap, context);
  vm.runInNewContext(initialTheme, context);
  return { dataset, properties, nativeBackgrounds, nativeThemeSources };
}

function windowsXpStylePack() {
  return [
    "tokens.css",
    "shell.css",
    "controls.css",
    "settings.css",
    "features/explorer.css",
    "surfaces/document.css",
    "surfaces/code.css",
    "surfaces/grid.css",
    "surfaces/editable-table.css",
    "surfaces/editor-controls.css",
    "surfaces/canvas.css",
    "surfaces/media.css",
    "surfaces/embedded.css",
    "features/agent.css",
  ].map((relativePath) => source(`src/styles/interfaces/windows-xp/${relativePath}`)).join("\n");
}

function source(relativePath: string) {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}
