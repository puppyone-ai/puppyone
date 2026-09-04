import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Desktop Terminal architecture boundaries", () => {
  it("keeps terminal processes user-owned and the content free of overlapping chrome", () => {
    const panel = source("src/features/desktop-terminal/ui/RightTerminalPanel.tsx");
    const closeDialog = source(
      "src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchCloseDialog.tsx",
    );
    const closeCoordinator = source(
      "src/features/app-shell/auxiliary-workbench/useAuxiliaryWorkbenchCloseCoordinator.ts",
    );
    const closePolicy = source(
      "src/features/desktop-terminal/model/terminalClosePolicy.ts",
    );
    const launcher = source("src/features/desktop-terminal/ui/TerminalLauncher.tsx");
    const launchers = source("src/features/desktop-terminal/model/terminalLaunchers.ts");
    const sessionView = source("src/features/desktop-terminal/ui/TerminalSessionView.tsx");
    const sessionHost = source("src/features/desktop-terminal/ui/TerminalSessionHost.tsx");
    const groupViewport = source(
      "src/features/desktop-terminal/workbench/TerminalWorkbenchViewport.tsx",
    );
    const persistentHosts = source(
      "src/features/desktop-terminal/layout/session-host/usePersistentTerminalSessionHosts.ts",
    );
    const hostSlot = source(
      "src/features/desktop-terminal/workbench/TerminalWorkbenchItemHostSlot.tsx",
    );
    const groupMoveHandle = source(
      "src/features/desktop-terminal/workbench/TerminalWorkbenchGroupMoveHandle.tsx",
    );
    const groupPane = source(
      "src/features/desktop-terminal/layout/TerminalGroupPane.tsx",
    );
    const groupHandleReveal = source(
      "src/features/desktop-terminal/layout/useTerminalPaneContentHandleReveal.ts",
    );
    const derivedDragClick = source(
      "src/features/desktop-terminal/interactions/useTerminalDerivedDragClickSuppression.ts",
    );
    const tabMove = source(
      "src/features/desktop-terminal/interactions/useTerminalTabMoveDrag.ts",
    );
    const interactionTermination = source(
      "src/features/workbench-interactions/useInteractionTermination.ts",
    );
    const tabBarDropTarget = source(
      "src/features/desktop-terminal/interactions/terminalTabBarDropTarget.ts",
    );
    const contentDropTarget = source(
      "src/features/desktop-terminal/interactions/terminalContentDropTarget.ts",
    );
    const tabMoveModel = source(
      "src/features/desktop-terminal/model/terminalTabMove.ts",
    );
    const sessionHeader = source(
      "src/features/desktop-terminal/workbench/TerminalWorkbenchHeader.tsx",
    );
    const controller = source("src/features/desktop-terminal/workbench/useTerminalWorkbench.ts");
    const agentLocatorController = source(
      "src/features/desktop-terminal/controller/useTerminalAgentLocator.ts",
    );
    const nativeAgentLocator = source(
      "electron/main/terminal-agent/terminal-agent-locator.mjs",
    );
    const nativeCandidateResolver = source(
      "electron/main/terminal-agent/terminal-agent-candidate-resolver.mjs",
    );
    const nativeIdentityVerifier = source(
      "electron/main/terminal-agent/terminal-agent-identity.mjs",
    );
    const runtime = source("src/features/desktop-terminal/runtime/terminalRuntime.ts");
    const registry = source("src/features/desktop-terminal/runtime/terminalRuntimeRegistry.ts");
    const titlebarActions = source("src/features/app-shell/DesktopTitlebarActions.tsx");
    const app = source("src/App.tsx");
    const titlebar = source("src/features/app-shell/headerElements.tsx");

    expect(panel).not.toContain("TerminalSurfaceActions");
    expect(panel).not.toContain("TerminalSurfaceHeader");
    expect(panel).toContain("useTerminalWorkbench");
    expect(panel).toContain("<TerminalSessionHost");
    expect(panel).not.toMatch(/<TerminalWorkbenchHeader[\s/>]/);
    expect(groupViewport).toContain("<TerminalWorkbenchHeader");
    expect(sessionHost).toContain("<TerminalSessionView");
    expect(panel).not.toContain("new Terminal(");
    expect(panel).not.toContain("window.puppyoneDesktop");
    expect(panel).toContain("useTerminalAgentLocator");
    expect(panel).toContain("hiddenAgentIds");
    expect(panel).toContain("availableAgentIds.filter");
    expect(panel).not.toContain("useInstalledTerminalAgents");
    expect(agentLocatorController).toContain("locateTerminalAgents");
    expect(agentLocatorController).not.toContain("discoverLocalTerminalAgents");
    expect(nativeAgentLocator).toContain("createTerminalAgentCandidateResolver");
    expect(nativeAgentLocator).toContain("publishProgress");
    expect(nativeAgentLocator).toContain("getDiagnostics");
    expect(nativeAgentLocator).not.toMatch(/runCommand|spawn\(|--version|account\/read|model\/list/);
    expect(nativeAgentLocator).not.toContain("local-agent-inventory");
    expect(nativeAgentLocator).not.toContain("agent/connections");
    expect(nativeCandidateResolver).toContain("createExecutableSearchContext");
    expect(nativeCandidateResolver).toContain("verifyTerminalAgentCandidateIdentity");
    expect(nativeCandidateResolver).not.toMatch(/runCommand|spawn\(|--version|account\/read|model\/list/);
    expect(nativeIdentityVerifier).toContain("MAX_EXECUTABLE_PREFIX_BYTES");
    expect(nativeIdentityVerifier).not.toMatch(/runCommand|spawn\(|--version|account\/read|model\/list/);
    expect(controller).toContain("auxiliaryWorkbenchReducer");
    expect(controller).toContain("reserveContributionItem");
    expect(controller).toContain("commitContributionItem");
    expect(controller).toContain('type: "create"');
    expect(controller).toContain('type: "split-item"');
    expect(controller).toContain('dispatchTerminal({ type: "launch"');
    expect(controller).toContain('dispatchTopology({ type: "activate"');
    expect(controller).toContain('dispatchTopology({ type: "close"');
    expect(controller).toContain("runtimeRegistry.ensure(itemId, launcherId, root.path)");
    expect(controller).toContain("runtimeRegistry.close(itemId)");
    expect(controller).not.toContain("pendingCloseItemId");
    expect(panel).not.toContain("useImperativeHandle");
    expect(panel).toContain("onCloseItem={(itemId)");
    expect(groupViewport).toContain("onClose={onCloseItem}");
    expect(panel).toContain("<AuxiliaryWorkbenchCloseDialog");
    expect(panel).toContain("useAuxiliaryWorkbenchCloseCoordinator");
    expect(panel).toContain("getTerminalClosePolicy(session.status)");
    expect(closePolicy).toContain('status === "starting" || status === "running"');
    expect(closeCoordinator).toContain("activeItemIdsRef");
    expect(closeDialog).toContain("<DesktopOverlayLayer>");
    expect(closeDialog).toContain("<DesktopDialogRoot");
    expect(panel).toContain("<TerminalLauncher");
    expect(panel).toContain("onCreateItem={(groupId) => workbench.createTerminalLauncher");
    expect(groupViewport).toContain("onCreate={() => onCreateItem(group.id)}");
    expect(panel).not.toContain("createOptions");
    expect(panel).not.toContain('createSession("shell")');
    expect(panel).toContain('session.status === "selecting"');
    expect(panel).toContain('workbench.items.length === 0');
    expect(panel).not.toContain("initiallyActive");
    expect(controller).not.toContain("initiallyActive");
    expect(controller).not.toContain("getDesktopTerminalLauncher(launcherId)");
    expect(launcher).toContain('getDesktopTerminalLauncher("shell")');
    expect(launcher).toContain("agentMode === \"chat\"");
    expect(launcher).toContain("chatRecipes.map");
    expect(launcher).toContain("terminalAgentLaunchers.map");
    expect(launcher).toContain("DESKTOP_TERMINAL_LAUNCHERS.filter");
    expect(panel).toContain('agentLauncherMode = agentChatContribution ? "chat" : "terminal"');
    expect(panel).toContain("agentMode={agentLauncherMode}");
    expect(panel).toContain('agentLauncherMode === "terminal"');
    expect(app).toContain("if (!desktopAgentChatEnabled) return null");
    expect(app).toContain("agentChatContribution ? [agentChatContribution] : []");
    expect(launcher).not.toContain("window.puppyoneDesktop");
    expect(launchers).not.toContain("command:");
    expect(controller).not.toContain('dispatch({ type: "restart-active" });');
    expect(panel).toContain("workbench.items.map");
    expect(sessionView).toContain("runtime.mount(container)");
    expect(sessionView).toContain("runtime.unmount(container)");
    expect(sessionView).toContain("runtime.setPresented(presented)");
    expect(sessionView).toContain("runtime.setFocused(focused)");
    expect(sessionView).not.toContain("runtime.dispose()");
    expect(sessionView).not.toContain("window.puppyoneDesktop?.closeTerminal");
    expect(runtime).toContain("void window.puppyoneDesktop?.closeTerminal?.(this.sessionId)");
    expect(runtime).toContain("sameTerminalSize(this.lastPtySize, size)");
    expect(runtime).toContain("launcherId: this.launcherId");
    expect(runtime).not.toContain("initialCommand");
    expect(runtime).not.toContain("[80, 180, 260]");
    expect(registry).toContain("runtime.dispose()");
    expect(registry).toContain("this.disposeTimer = setTimeout");
    expect(panel).not.toContain("handleClearTerminal");
    expect(panel).toContain("<TerminalWorkbenchViewport");
    expect(panel).toContain("createPortal(");
    expect(hostSlot).toContain('role="tabpanel"');
    expect(hostSlot).not.toContain("TerminalPaneMoveHandle");
    expect(groupViewport).toContain("<TerminalWorkbenchItemHostSlot");
    expect(groupViewport).toContain("<TerminalWorkbenchGroupMoveHandle");
    expect(groupViewport).toContain("<TerminalGroupPane");
    expect(groupMoveHandle).toContain("<i /><i /><i />");
    expect(groupMoveHandle).toContain('{ kind: "group", groupId');
    expect(groupPane).toContain("data-terminal-content-drop-group-id={groupId}");
    expect(groupPane).toContain("data-terminal-group-pane-id={groupId}");
    expect(groupPane).toContain("{header}");
    expect(groupPane).toContain("{children}");
    expect(groupPane.indexOf("{header}")).toBeLessThan(
      groupPane.indexOf('className="desktop-terminal-tab-group-content"'),
    );
    expect(groupPane).toContain("{contentDropIntent && (");
    expect(groupHandleReveal)
      .toContain("TERMINAL_PANE_CONTENT_HANDLE_REVEAL_RATIO = 1 / 3");
    expect(groupViewport).toContain("items={headerItems}");
    expect(groupViewport).toContain("tabMove={itemMove}");
    expect(derivedDragClick).toContain("window.setTimeout(clear, 0)");
    expect(persistentHosts).toContain("document.createElement(\"div\")");
    expect(tabMove).toContain('acquireNativeSurfacePointerPassthroughLease(\n        "terminal-tab-move"');
    expect(contentDropTarget).toContain("closestWorkbenchSplitDropEdge");
    expect(tabMove).toContain('subject.kind === "group"');
    expect(tabMove).toContain('? "[data-terminal-group-pane-id]"');
    expect(tabMove).toContain(': ".desktop-terminal-tab"');
    expect(tabMove).toContain("resolveTerminalContentDropTarget");
    expect(contentDropTarget)
      .toContain('closest<HTMLElement>(\n    "[data-terminal-content-drop-group-id]"');
    expect(tabMove).toContain("TERMINAL_TAB_MOVE_THRESHOLD_PX = 6");
    expect(tabMove).toContain("TERMINAL_GROUP_HANDLE_MOVE_THRESHOLD_PX = 3");
    expect(tabMove).toContain("TERMINAL_TRANSIENT_WINDOW_BLUR_GRACE_MS = 48");
    expect(tabMove).toContain('window.addEventListener("pointermove"');
    expect(tabMove).toContain('window.addEventListener("pointerup"');
    expect(tabMove).toContain("if ((event.buttons & 1) === 1)");
    expect(interactionTermination).toContain("blurGraceMs");
    expect(interactionTermination).toContain('window.addEventListener("focus", handleFocus');
    expect(tabMove).toContain("resolveTerminalTabBarDropTarget");
    expect(tabMove.indexOf("const insertion = resolveTerminalTabBarDropTarget"))
      .toBeLessThan(tabMove.indexOf("const contentTarget = resolveTerminalContentDropTarget"));
    expect(tabMove).toContain('kind: "insert"');
    expect(tabMove).toContain("session.onInsertSession");
    expect(tabBarDropTarget).toContain("data-terminal-tab-bar-group-id");
    expect(tabBarDropTarget).toContain("data-terminal-tab-group-index");
    expect(tabBarDropTarget).toContain("excludedSessionIds");
    expect(tabBarDropTarget).toContain("getComputedStyle(tabBar).direction");
    expect(tabMoveModel).toContain('kind: "split"');
    expect(tabMoveModel).toContain('kind: "insert"');
    expect(tabMoveModel).toContain('kind: "move-group"');
    expect(tabMoveModel).toContain('kind: "merge-group"');
    expect(tabMoveModel).toContain("projectTerminalTabInsertionPreview");
    expect(sessionHeader).toContain("desktop-terminal-tab-drop-slot");
    expect(sessionHeader).toContain("data-terminal-tab-bar-group-id={groupId}");
    expect(sessionHeader).not.toContain("desktop-terminal-subheader-new");
    expect(runtime).toContain('import { WebLinksAddon } from "@xterm/addon-web-links"');
    expect(runtime).toContain("linkHandler:");
    expect(runtime).toContain("allowNonHttpProtocols: false");
    expect(runtime).toContain("terminal.loadAddon(new WebLinksAddon");
    expect(runtime).toContain("bridge.createTerminal(createTerminalPtyRequest");
    expect(runtime).toContain("rootPath: workspacePath");
    expect(runtime).toContain("bridge.openExternalUrl(href)");
    expect(titlebarActions).not.toContain('t("terminal.actions")');
    expect(titlebarActions).not.toContain("TerminalTitlebarMenu");
    expect(app).not.toContain("terminalSessionResetToken");
    expect(app).not.toContain("terminalPanelRef");
    expect(app).not.toContain("terminalSnapshot");
    expect(app).not.toContain("onSessionsChange");
    expect(controller).not.toContain("onSessionsChange");
    expect(app).toContain("hiddenAgentIds={localAgentsSettings.hiddenTerminalAgentIds}");
    expect(app).not.toContain("enabledLocalAgentRuntimeIds");
    expect(app).not.toContain("isLocalAgentRuntimeEnabled");
    expect(titlebar).not.toContain("Clear Terminal");
    expect(titlebar).not.toContain("Reset Terminal");
    expect(titlebar).not.toContain("has-menu");
    expect(titlebar).toContain('aria-pressed={terminal.sidebarOpen}');
  });

  it("keeps terminal presentation styles co-located with the feature", () => {
    const panel = source("src/features/desktop-terminal/ui/RightTerminalPanel.tsx");
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
      "src/features/desktop-terminal/model/terminalSessionHeaderLayout.ts",
    );
    const headerPresentation = source(
      "src/features/desktop-terminal/model/terminalSessionHeader.ts",
    );
    const headerOverflow = source(
      "src/features/desktop-terminal/ui/session-header/TerminalSessionOverflowMenu.tsx",
    );
    const headerController = source(
      "src/features/desktop-terminal/ui/session-header/useTerminalSessionHeaderController.ts",
    );
    const headerLayoutHook = source(
      "src/features/desktop-terminal/ui/session-header/useTerminalSessionHeaderLayout.ts",
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
    expect(headerController).toContain("TERMINAL_SESSION_HEADER_METRICS.activationMotionMs");
    expect(headerLayout).toContain("activationMotionMs: 220");
    expect(headerLayout).toContain("canPreserveVisibleWindow");
    expect(headerLayoutHook).toContain("preferredVisibleSessionIds: visibleWindow");
    expect(headerLayoutHook).toContain("capacityRef");
    expect(headerLayoutHook).not.toContain("railRef");
    expect(headerLayoutHook).toContain("TERMINAL_SESSION_HEADER_METRICS.createControl");
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
    const panel = source("src/features/desktop-terminal/ui/RightTerminalPanel.tsx");
    const header = source(
      "src/features/desktop-terminal/workbench/TerminalWorkbenchHeader.tsx",
    );
    const tab = source(
      "src/features/desktop-terminal/workbench/TerminalWorkbenchTab.tsx",
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
    expect(tab).toContain("useTerminalDerivedDragClickSuppression");
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
    expect(panel).toContain("workbench.items.length === 0 ? (");
    expect(panel).toContain(": workbench.root ? (");
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
