import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Desktop Terminal architecture boundaries", () => {
  it("keeps the workbench generic and terminal lifetime owned by its project", () => {
    const panel = source("src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel.tsx");
    const launcher = source("src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchLauncher.tsx");
    const pool = source("src/features/desktop-terminal/runtime/TerminalRuntimePool.ts");
    const contribution = source("src/features/desktop-terminal/workbench/TerminalWorkbenchContribution.tsx");
    const view = source("src/features/desktop-terminal/ui/TerminalSessionView.tsx");
    const runtime = source("src/features/desktop-terminal/runtime/terminalRuntime.ts");
    const app = source("src/App.tsx");
    expect(panel).not.toMatch(/TerminalRuntime|AgentSessionController|puppyoneDesktop/);
    expect(panel).toContain("createPortal(");
    expect(panel).toContain("useAuxiliaryWorkbenchCloseCoordinator");
    expect(launcher).toContain("useTerminalAgentLocator");
    expect(launcher).toContain("hiddenAgentIds");
    expect(pool).toContain("workspacePath: this.project.context.rootPath");
    expect(pool).toContain("projectContext: this.project.context");
    expect(pool).toContain("await entry.runtime.close()");
    expect(pool).not.toMatch(/retainCount|disposeTimer/);
    expect(contribution).toContain("<TerminalSessionView");
    expect(contribution).toContain("getTerminalClosePolicy");
    expect(view).not.toContain("runtime.dispose()");
    expect(view).not.toContain("closeTerminal");
    expect(runtime).toContain("unwrapProjectSessionResult(await bridge.closeTerminal(this.requestIdentity()))");
    expect(runtime).toContain("sameTerminalSize(this.lastPtySize, size)");
    expect(app).toContain("createTerminalWorkbenchContribution(t)");
    expect(app).not.toContain("RightTerminalPanel");
  });

  it("keeps terminal presentation styles co-located with the feature", () => {
    const panel = source("src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel.tsx");
    const css = source("src/features/desktop-terminal/ui/desktop-terminal.css");
    const sessionView = source("src/features/desktop-terminal/ui/TerminalSessionView.tsx");
    const launcher = source("src/features/desktop-terminal/ui/TerminalLauncher.tsx");
    const launcherCss = source("src/features/desktop-terminal/ui/terminal-launcher.css");
    const launcherIconCss = source(
      "src/features/desktop-terminal/ui/terminal-launcher-icon.css",
    );
    const activityGridCss = source(
      "src/features/desktop-terminal/ui/terminal-activity-grid.css",
    );
    const header = source(
      "src/features/desktop-terminal/ui/session-header/TerminalSessionHeader.tsx",
    );
    const headerTab = source(
      "src/features/desktop-terminal/ui/session-header/TerminalSessionTab.tsx",
    );
    const headerStatus = source(
      "src/features/desktop-terminal/ui/session-header/TerminalSessionHeaderStatus.tsx",
    );
    const headerLayout = source(
      "src/features/app-shell/auxiliary-workbench/layout/workbenchSessionHeaderLayout.ts",
    );
    const headerPresentation = source(
      "src/features/desktop-terminal/model/terminalSessionHeader.ts",
    );
    const headerOverflow = source(
      "src/features/desktop-terminal/ui/session-header/TerminalSessionOverflowMenu.tsx",
    );
    const headerController = source(
      "src/features/app-shell/auxiliary-workbench/layout/useWorkbenchSessionHeaderController.ts",
    );
    const headerLayoutHook = source(
      "src/features/app-shell/auxiliary-workbench/layout/useWorkbenchSessionHeaderLayout.ts",
    );
    const headerCss = source(
      "src/features/desktop-terminal/ui/session-header/terminal-session-header.css",
    );
    const xpTokensCss = source("src/styles/interfaces/windows-xp/tokens.css");
    const terminalActivity = source(
      "src/features/desktop-terminal/runtime/terminalActivity.ts",
    );
    const runtime = source("src/features/desktop-terminal/runtime/terminalRuntime.ts");
    const globalLayout = source("src/styles/layout.css");
    expect(css).not.toContain(".desktop-terminal-surface-actions");
    expect(css).not.toContain(".desktop-terminal-action-trigger");
    expect(css).not.toContain(".desktop-terminal-surface-header");
    expect(css).toContain(".desktop-terminal-session.is-presented");
    expect(css).toContain(".desktop-terminal-group-viewport");
    expect(css).toContain(".desktop-terminal-tab-group");
    expect(css).toContain(".desktop-terminal-tab-group-content");
    expect(css).toContain(".desktop-terminal-splitter");
    expect(css).toContain(".desktop-terminal-drop-preview");
    expect(css).toContain(".desktop-terminal-pane-handle-shell");
    expect(css).toContain(".desktop-terminal-pane-handle");
    expect(css).toContain(".desktop-terminal-pane-interaction-frame");
    expect(css).not.toContain(".desktop-terminal-launcher");
    expect(launcher).toContain('import "./terminal-launcher.css"');
    expect(launcherCss).toContain(".desktop-terminal-launcher");
    expect(launcherCss).toContain("container-type: size");
    expect(launcherCss).toMatch(
      /\.desktop-terminal-launcher\s*\{[^}]*place-items:\s*safe center;[^}]*padding:\s*32px 0;/s,
    );
    expect(launcherCss).toMatch(
      /\.desktop-terminal-launcher-availability\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*height:\s*1px;/s,
    );
    expect(launcherCss).not.toContain(".desktop-terminal-launcher-rail");
    expect(launcherCss).toContain("var(--po-terminal-bg)");
    expect(launcherCss).toContain("var(--po-focus-ring)");
    expect(launcherIconCss).toMatch(
      /\.desktop-terminal-launcher-icon\.is-compact\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;/s,
    );
    expect(launcherIconCss).toContain(".desktop-terminal-launcher-icon.is-compact.is-hermes");
    expect(launcher).toContain("desktop-terminal-launcher-heading");
    expect(launcher).toContain("desktop-terminal-launcher-scan");
    expect(launcher).toContain("desktop-terminal-launcher-group is-agents");
    expect(launcher).toContain("desktop-terminal-launcher-group is-history-entry");
    expect(launcher).toContain("desktop-terminal-launcher-divider");
    expect(launcher).toContain('"terminal.launcher.title"');
    expect(launcher).toContain('"agent.history.continueTitle"');
    expect(launcher).toContain('aria-label={t("terminal.launcher.scanAgain")}');
    expect(launcherCss).toMatch(/\.desktop-terminal-launcher-content\s*\{[^}]*gap:\s*28px;/s);
    expect(launcherCss).toMatch(/\.desktop-terminal-launcher-heading h2\s*\{[^}]*font-size:\s*var\(--po-type-right-sidebar-meta, 13px\);[^}]*font-weight:\s*500;/s);
    expect(launcherCss).toMatch(/\.desktop-terminal-launcher-tool,\s*\.desktop-terminal-launcher-shell,\s*\.desktop-terminal-launcher-history\s*\{[^}]*min-height:\s*var\(--po-control-size-large\);[^}]*border-radius:\s*6px;/s);
    expect(launcherCss).toContain('.desktop-terminal-launcher-tool[data-status="coming-soon"]::after');
    expect(launcherCss).not.toContain("aspect-ratio:");
    expect(header).toContain('import "./terminal-session-header.css"');
    expect(header).toContain("<TerminalSessionTab");
    expect(header).toContain("<TerminalSessionOverflowMenu");
    expect(header).toContain("useTerminalSessionHeaderController");
    expect(header).toContain("useTerminalSessionHeaderLayout");
    expect(header).toContain("data-activation-motion");
    expect(headerTab).toContain("<TerminalSessionHeaderStatus");
    expect(headerPresentation).toContain("terminalPathLabel(workspacePath)");
    expect(headerPresentation).toContain("presentTerminalSessionHeader");
    expect(headerStatus).toContain("runtime.subscribeActivity(setActive)");
    expect(headerStatus).toContain("<TerminalActivityGrid");
    expect(headerStatus).toContain("<TerminalLauncherIcon");
    expect(headerLayout).toContain('mode: "full"');
    expect(headerLayout).toContain('"compact"');
    expect(headerLayout).toContain('"overflow"');
    expect(headerOverflow).toContain("<DesktopMenuSurface");
    expect(headerOverflow).toContain("<TerminalSessionHeaderStatus");
    expect(headerController).toContain("WORKBENCH_SESSION_HEADER_METRICS.activationMotionMs");
    expect(headerLayout).toContain("activationMotionMs: 220");
    expect(headerLayout).toContain("canPreserveVisibleWindow");
    expect(headerLayoutHook).toContain("preferredVisibleSessionIds: visibleWindow");
    expect(headerLayoutHook).toContain("capacityRef");
    expect(headerLayoutHook).not.toContain("railRef");
    expect(headerLayoutHook).toContain("WORKBENCH_SESSION_HEADER_METRICS.createControl");
    expect(header).not.toContain("Working");
    expect(header).not.toContain("brailleSpinnerFrames");
    expect(terminalActivity).toContain("TerminalActivityController");
    expect(terminalActivity).toContain("cursorBusyLabels");
    expect(terminalActivity).toContain("noteOutput");
    expect(terminalActivity).toContain("beginPresentationRefresh");
    expect(runtime).toContain("this.activityController.beginPresentationRefresh()");
    expect(activityGridCss).toContain("grid-template-columns: repeat(2");
    expect(activityGridCss).not.toContain("border-radius");
    expect(headerCss).not.toContain("desktop-terminal-tab-activity-dot");
    expect(panel).not.toContain("<SquareTerminal");
    expect(headerCss).toContain("border-radius: var(--desktop-toolbar-action-radius);");
    expect(headerCss).not.toContain("background: var(--po-selected);");
    expect(headerCss).toContain(
      "background: var(--desktop-terminal-tab-active-background, var(--po-control));",
    );
    expect(headerCss).toMatch(
      /\.desktop-terminal-tab\s*\{[^}]*border:\s*var\(--desktop-terminal-tab-border, 0\);/s,
    );
    expect(headerCss).not.toContain("--desktop-terminal-tab-idle-border");
    expect(headerCss).not.toContain("--desktop-terminal-tab-active-indicator");
    expect(headerCss).not.toContain(".desktop-terminal-tab::after");
    expect(headerCss).not.toContain(".desktop-terminal-tab-shell");
    expect(headerLayout).toContain("tabBounds");
    expect(headerLayout).toContain("inlineStart");
    expect(headerCss).toMatch(/\.desktop-terminal-tab-rail\s*\{[^}]*flex:\s*1 1 auto;/s);
    expect(headerCss).toMatch(
      /\.desktop-terminal-new-button\s*\{[^}]*flex:\s*0 0 var\(--desktop-terminal-tab-control-height\);[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
    );
    expect(headerCss).toMatch(
      /\.desktop-terminal-tabs\s*\{[^}]*position:\s*relative;[^}]*width:\s*var\(--desktop-terminal-tabs-resolved-width\);/s,
    );
    expect(headerCss).toMatch(
      /\.desktop-terminal-tab\s*\{[^}]*position:\s*absolute;[^}]*inset-inline-start:\s*var\(--desktop-terminal-tab-inline-start\);/s,
    );
    expect(headerCss).toMatch(/\.desktop-terminal-tab\s*\{(?![^}]*transition:)[^}]*\}/s);
    expect(headerCss).toMatch(
      /\.desktop-terminal-tab-rail\[data-activation-motion="true"\] \.desktop-terminal-tab\s*\{[^}]*inset-inline-start var\(--desktop-terminal-tab-activation-motion\)[^}]*width var\(--desktop-terminal-tab-activation-motion\)/s,
    );
    expect(headerCss).toMatch(
      /\.desktop-terminal-tab-select\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*var\(--desktop-terminal-tab-control-height\) minmax\(0, 1fr\);/s,
    );
    expect(headerCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".desktop-terminal-session:not(.is-ready) .desktop-terminal-xterm");
    expect(headerCss).toContain("--desktop-terminal-tab-control-height: 28px;");
    expect(headerCss).toMatch(
      /\.desktop-terminal-tab-status\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*flex:\s*0 0 14px;/s,
    );
    expect(headerCss).toMatch(
      /\.desktop-terminal-subheader\s*\{[^}]*height:\s*var\(--desktop-terminal-group-header-size, 38px\);/s,
    );
    expect(headerCss).toMatch(
      /\.desktop-terminal-tab-select\s*\{[^}]*font-size:\s*var\(--po-type-header-content, 15px\);/s,
    );
    expect(headerCss).toMatch(
      /\.desktop-terminal-tab-title\s*\{[^}]*font-weight:\s*var\(--desktop-sidebar-font-weight, var\(--po-text-weight-medium, 500\)\);/s,
    );
    expect(headerCss).not.toMatch(/\.desktop-terminal-tab-select\s*\{[^}]*font-size:\s*11px;/s);
    expect(headerCss).toMatch(
      /\.desktop-terminal-subheader\s*\{[^}]*border-block-end:\s*var\(--desktop-terminal-tab-bar-divider, 0\);[^}]*background:\s*var\(--desktop-terminal-tab-bar-background, var\(--po-terminal-bg\)\);/s,
    );
    expect(headerCss).not.toContain(".desktop-terminal-subheader::after");
    expect(xpTokensCss).toContain("--desktop-terminal-tab-bar-padding-end: 5px;");
    expect(xpTokensCss).toContain("--desktop-terminal-tab-bar-divider: 1px solid #aca899;");
    expect(xpTokensCss).toContain("--desktop-terminal-tab-bar-background: #f5f4ee;");
    expect(xpTokensCss).toContain("--desktop-terminal-tab-border: 1px solid transparent;");
    expect(xpTokensCss).not.toContain("--desktop-terminal-tab-bar-border");
    expect(xpTokensCss).toContain("--desktop-terminal-tab-active-background: #ddd9cf;");
    expect(xpTokensCss).toContain("--desktop-terminal-tab-hover-border: #c7c4ba;");
    expect(xpTokensCss).toContain("--desktop-terminal-tab-active-border: #9d9a90;");
    expect(xpTokensCss).not.toContain("--desktop-terminal-tab-active-indicator");
    expect(xpTokensCss).not.toContain("--desktop-terminal-tab-active-background: #1059c9;");
    expect(xpTokensCss).not.toContain("--desktop-terminal-tab-active-background: #316ac5;");
    expect(css).not.toContain(".desktop-terminal-subheader");
    expect(css).toContain("text-spacing-trim: space-all");
    expect(css).toContain(
      "--desktop-terminal-scrollbar-track-size: var(--po-scrollbar-size, 12px);",
    );
    expect(css).toContain(
      "--desktop-terminal-scrollbar-thumb-active-size: var(--po-scrollbar-thumb-active-size, 8px);",
    );
    expect(css).toContain(
      "--desktop-terminal-scrollbar-thumb-inset: var(--po-scrollbar-thumb-inset, 3px);",
    );
    expect(css).toContain("--po-scrollbar-thumb-active-inset,");
    expect(css).toContain(':root[data-interface-style="default"] .desktop-terminal-xterm');
    expect(css).toContain(
      "--desktop-terminal-scrollbar-thumb-color: var(",
    );
    expect(css).toContain("--po-scrollbar-presentation-thumb,");
    expect(css).toContain(".desktop-terminal-xterm.po-scrollbar-active");
    expect(css).not.toContain(".desktop-terminal-xterm:focus-within");
    expect(runtime).toContain("terminal.onScroll(() => {");
    expect(runtime).toContain("this.markScrollbarActive();");
    expect(runtime).toContain("this.syncScrollbarPresentation();");
    expect(runtime).toContain('container.classList.add("po-scrollbar-active")');
    expect(runtime).toContain("this.terminal?.scrollLines(direction)");
    expect(runtime).toContain("terminal.scrollToLine(nextViewportY)");
    expect(sessionView).toContain("desktop-terminal-classic-scrollbar-controls");
    expect(sessionView).toContain("desktop-terminal-classic-scrollbar-button");
    expect(sessionView).not.toContain("po-classic-scrollbar-button");
    expect(sessionView).toContain("runtime.subscribeScrollbar(setScrollbarState)");
    expect(css).toContain(".desktop-terminal-classic-scrollbar-track");
    expect(css).toContain(".desktop-terminal-classic-scrollbar-thumb");
    expect(css).toMatch(
      /\.xterm-scrollable-element > \.scrollbar\.vertical\s*\{[^}]*width:\s*var\(--desktop-terminal-scrollbar-track-size\) !important;/s,
    );
    expect(css).toMatch(
      /\.xterm-scrollable-element > \.scrollbar > \.slider\s*\{[^}]*width:\s*var\(--desktop-terminal-scrollbar-track-size\) !important;/s,
    );
    expect(css).toContain(
      ".desktop-terminal-xterm .xterm .xterm-scrollable-element > .scrollbar > .slider::after",
    );
    expect(css).toMatch(
      /\.slider::after\s*\{[^}]*inset-inline-end:\s*var\(--desktop-terminal-scrollbar-thumb-inset\);[^}]*width:\s*var\(--desktop-terminal-scrollbar-thumb-size\);[^}]*pointer-events:\s*none;/s,
    );
    expect(css).toContain(
      "inset-inline-end: var(--desktop-terminal-scrollbar-thumb-active-inset);",
    );
    expect(css).toContain(
      "border-inline-width: var(--desktop-terminal-scrollbar-thumb-inset);",
    );
    expect(css).not.toContain("border-left-width:");
    expect(globalLayout).not.toContain(".desktop-terminal-");
  });

  it("keeps plain output close to editor text while preserving ANSI tiers", () => {
    const tokens = source("src/styles/tokens.css");
    const neutralTheme = source("sub-themes/default-neutral/theme.css");
    const light = terminalNeutralTier(neutralTheme, ":root");
    const dark = terminalNeutralTier(neutralTheme, ".dark .theme-root");

    expect(tokens).toMatch(
      /--po-terminal-fg:\s*color-mix\(in srgb, var\(--po-text\) 70%, var\(--po-text-muted\)\);/,
    );
    expect(tokens.match(/--po-terminal-fg:/g)).toHaveLength(1);
    expect(tokens).not.toContain("--po-terminal-black:");
    expect(relativeLuminance(light.text)).toBeLessThan(relativeLuminance(light.foreground));
    expect(relativeLuminance(light.foreground)).toBeLessThan(relativeLuminance(light.muted));
    expect(relativeLuminance(dark.text)).toBeGreaterThan(relativeLuminance(dark.foreground));
    expect(relativeLuminance(dark.foreground)).toBeGreaterThan(relativeLuminance(dark.muted));
    expect(new Set(light.neutralAnsi).size).toBe(light.neutralAnsi.length);
    expect(new Set(dark.neutralAnsi).size).toBe(dark.neutralAnsi.length);
  });

  it("keeps Terminal visibility separate from its native Group manager", () => {
    const titlebarActions = source("src/features/app-shell/DesktopTitlebarActions.tsx");
    const panel = source("src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel.tsx");
    const header = source(
      "src/features/app-shell/auxiliary-workbench/layout/AuxiliaryWorkbenchHeader.tsx",
    );
    const tab = source(
      "src/features/app-shell/auxiliary-workbench/layout/AuxiliaryWorkbenchTab.tsx",
    );
    const settings = source("src/features/settings/SettingsView.tsx");
    const preferences = source("src/preferences.ts");
    const desktopPreferences = source("src/features/app-shell/useDesktopPreferences.ts");
    const titlebarCss = source("src/styles/titlebar.css");
    expect(titlebarActions).toContain("onToggleTerminal");
    expect(titlebarActions).not.toContain("TerminalTitlebarMenu");
    expect(titlebarActions).not.toContain('id: "terminal-menu"');
    expect(titlebarActions).not.toContain("terminalSessionLayout");
    expect(header).toContain('role="tablist"');
    expect(tab).toContain('role="tab"');
    expect(tab).toContain("onActivate(item.id)");
    expect(tab).toContain("suppressDerivedDragClick");
    expect(tab).toContain("useWorkbenchDerivedDragClickSuppression");
    expect(tab).not.toContain("event.detail === 0");
    expect(tab).not.toContain('tabMove.end(event) === "press"');
    expect(tab).toContain("onClose(item.id)");
    expect(tab).toContain("tabMove.start(");
    expect(header).toContain("presentedItemIds");
    expect(header).not.toContain("TerminalSessionLayoutMenu");
    expect(header).not.toContain("onUnsplitActive");
    expect(header).toContain("<DesktopMenuIconButton");
    expect(header).toContain("onClick={onCreate}");
    expect(header).not.toContain("TerminalWorkbenchCreateMenu");
    expect(header).not.toContain("aria-haspopup");
    expect(panel).toContain("workbench.items.length === 0 ? renderLauncher");
    expect(panel).toContain(": workbench.root && <AuxiliaryWorkbenchViewport");
    expect(panel).not.toContain("sessionLayout");
    expect(settings).not.toContain("terminalLayout");
    expect(preferences).not.toContain("TerminalSessionLayout");
    expect(preferences).not.toContain("terminalSessionLayout");
    expect(desktopPreferences).not.toContain("terminalSessionLayout");
    expect(titlebarCss).not.toContain(".desktop-titlebar-terminal-menu");
  });
});

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function terminalNeutralTier(stylesheet: string, selector: string) {
  const block = cssSelectorBlock(stylesheet, selector);
  const text = cssHexToken(block, "--po-text");
  const muted = cssHexToken(block, "--po-text-muted");
  const foreground = mixSrgbHex(text, muted, 0.7);
  return {
    text,
    muted,
    foreground,
    neutralAnsi: [
      "--po-terminal-black",
      "--po-terminal-bright-black",
      "--po-terminal-white",
      "--po-terminal-bright-white",
    ].map((token) => cssHexToken(block, token)).concat(foreground),
  };
}

function cssSelectorBlock(stylesheet: string, selector: string) {
  const start = stylesheet.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing CSS selector: ${selector}`);
  const end = stylesheet.indexOf("\n}", start);
  if (end < 0) throw new Error(`Unterminated CSS selector: ${selector}`);
  return stylesheet.slice(start, end);
}

function cssHexToken(block: string, token: string) {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`${escapedToken}:\\s*(#[0-9a-f]{6});`, "i"));
  if (!match) throw new Error(`Missing hexadecimal CSS token: ${token}`);
  return match[1].toLowerCase();
}

function mixSrgbHex(primary: string, secondary: string, primaryWeight: number) {
  const channels = [1, 3, 5].map((offset) => {
    const primaryChannel = Number.parseInt(primary.slice(offset, offset + 2), 16);
    const secondaryChannel = Number.parseInt(secondary.slice(offset, offset + 2), 16);
    return Math.round(
      primaryChannel * primaryWeight + secondaryChannel * (1 - primaryWeight),
    );
  });
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
