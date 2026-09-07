import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Desktop Agent architecture boundaries", () => {
  it("keeps RightAgentPanel as composition and the controller framework independent", () => {
    const panel = source("src/features/desktop-agent/ui/RightAgentPanel.tsx");
    const tabPanel = source("src/features/desktop-agent/ui/AgentChatTabPanel.tsx");
    const workbenchItem = source(
      "src/features/desktop-agent/workbench/AgentChatWorkbenchItem.tsx",
    );
    const layout = source("src/features/desktop-agent/ui/AgentPanelLayout.tsx");
    const controller = source("src/features/desktop-agent/application/AgentSessionController.ts");
    const preparer = source("src/features/desktop-agent/application/AgentSessionPreparer.ts");
    expect(panel.split("\n").length).toBeLessThan(230);
    expect(panel).not.toMatch(/useState|bufferedEvents|replayInFlight|applyAgentEvent/);
    expect(panel).toContain("<AgentSessionTabs");
    expect(panel).toContain("<AgentChatTabPanel");
    expect(tabPanel).toContain("<AgentPanelLayout");
    expect(tabPanel).toContain("const presented = presentedProp ?? active");
    expect(tabPanel).toContain("const commandTarget = commandTargetProp ?? active");
    expect(tabPanel).toContain("active: commandTarget, controller");
    expect(workbenchItem).toContain("commandTarget={presentation.commandTarget}");
    expect(workbenchItem).toContain("presented={presentation.presented}");
    expect(layout).toContain('className="desktop-agent-boundary"');
    expect(layout).toContain('className="desktop-agent-panel"');
    expect(layout).toContain('className="desktop-agent-conversation-region"');
    expect(layout).toContain("desktop-agent-conversation-overlay");
    expect(layout).toContain('className="desktop-agent-dock-region"');
    expect(layout).not.toContain("dropActive");
    expect(layout).not.toContain("dropInvalid");
    expect(layout).not.toContain("desktop-agent-reference-drop-overlay");
    expect(controller).not.toMatch(/from ["']react["']|JSX\.|<section/);
    expect(controller).toContain("agentControllerTransitions");
    expect(controller).toContain("prepareSession()");
    expect(controller).toContain("new AgentSessionPreparer");
    expect(controller).toContain("this.sessionPreparer.prepare()");
    expect(preparer).toContain("preparationPromise");
    expect(preparer).toContain("closeStale");
    expect(source("src/features/desktop-agent/ui/useAgentSessionPreparation.ts")).toContain("controller.prepareSession()");
  });

  it("enforces virtual, responsive, safe presentation contracts", () => {
    const timeline = source("src/features/desktop-agent/ui/AgentTranscript.tsx");
    const timelineLayout = source("src/features/desktop-agent/ui/transcript/transcript-layout.ts");
    const timelinePresentation = source("src/features/desktop-agent/ui/transcript/transcript-rows.ts");
    const emptyState = source("src/features/desktop-agent/ui/AgentEmptyState.tsx");
    const markdown = source("src/features/desktop-agent/ui/SafeMarkdown.tsx");
    const markdownDocument = source("src/features/desktop-agent/ui/markdown/AgentMarkdownDocument.tsx");
    const markdownPolicy = source("src/features/desktop-agent/ui/markdown/agentMarkdownPolicy.ts");
    const markdownRegistry = source("src/features/desktop-agent/ui/markdown/agentMarkdownBlockRegistry.tsx");
    const composer = source("src/features/desktop-agent/ui/AgentComposer.tsx");
    const promptEditor = source("src/features/desktop-agent/ui/composer/AgentPromptEditor.tsx");
    const composerToolbar = source("src/features/desktop-agent/ui/composer/AgentComposerToolbar.tsx");
    const attachmentButton = source("src/features/desktop-agent/ui/composer/AgentAttachmentButton.tsx");
    const commandSuggestions = source("src/features/desktop-agent/ui/composer/AgentCommandSuggestions.tsx");
    const draftReferences = source("src/features/desktop-agent/ui/composer/AgentDraftReferenceList.tsx");
    const sessionControlPicker = source("src/features/desktop-agent/ui/AgentSessionControlPicker.tsx");
    const sessionControls = source("src/features/desktop-agent/domain/agent-session-controls.ts");
    const picker = source("src/features/desktop-agent/ui/AgentPickerPopover.tsx");
    const pickerPresentation = source("src/features/desktop-agent/ui/agent-picker-presentation.ts");
    const desktopMenu = source("src/components/DesktopMenu.tsx");
    const eventSynchronizer = source("src/features/desktop-agent/application/AgentSessionReplica.ts");
    const streamScheduler = source("src/features/desktop-agent/ui/agent-stream-frame-scheduler.ts");
    const streamPresentation = source("src/features/desktop-agent/ui/useAgentStreamPresentation.ts");
    const streamPolicy = source("src/features/desktop-agent/domain/agent-stream-presentation.ts");
    const runtimeGeometry = source("src/features/desktop-agent/ui/agent-runtime-geometry.ts");
    const cssEntry = source("src/features/desktop-agent/ui/desktop-agent.css");
    const theme = source("src/features/desktop-agent/ui/styles/theme.css");
    const foundation = source("src/features/desktop-agent/ui/styles/foundation.css");
    const pickers = source("src/features/desktop-agent/ui/styles/pickers.css");
    const css = agentStyles();
    const globalLayout = source("src/styles/layout.css");
    expect(timelineLayout).toContain("maxMountedRows: 120");
    expect(timelineLayout).toContain("buildAgentTimelineLayout");
    expect(timelineLayout).toContain("agentTimelineGapAfter");
    expect(timelinePresentation).toContain("buildAgentTimeline");
    expect(timelinePresentation).toContain('part.kind === "usage"');
    expect(timelinePresentation).toContain('part.kind !== "reasoning"');
    expect(timelinePresentation).toContain(".includes(part.status)");
    expect(timeline).toContain("buildAgentTimeline(projection, compactRowHeight,");
    expect(timeline).toContain("useTranscriptViewport(");
    expect(source("src/features/desktop-agent/ui/transcript/useTranscriptViewport.ts")).toContain("buildAgentTimelineLayout(rows");
    expect(timeline).not.toContain("function buildLayout(");
    expect(timeline).toContain("emptyState?: ReactNode");
    expect(timeline).toContain("showEmptyState && emptyState");
    expect(emptyState).toContain("<AgentBrandMark");
    expect(emptyState).not.toMatch(/selectedModel|AgentModelPicker/);
    expect(source("src/features/desktop-agent/ui/AgentChatTabPanel.tsx")).toContain(
      "const showReadyEmptyState = routingReady",
    );
    expect(markdown).not.toContain("dangerouslySetInnerHTML");
    expect(markdownDocument).not.toContain("dangerouslySetInnerHTML");
    expect(markdownDocument).toContain("remarkGfm");
    expect(markdownDocument).toContain("createAgentMarkdownComponents");
    expect(markdownPolicy).toContain('new Set(["https:", "http:", "mailto:"])');
    expect(markdownPolicy).toContain('if (key === "src" || key === "srcSet") return null');
    expect(markdownRegistry).toContain("createAgentMarkdownBlockRegistry");
    expect(markdownRegistry).toContain('id: "mermaid"');
    expect(cssEntry).toContain('@import "./styles/theme.css"');
    expect(cssEntry).toContain('@import "./styles/foundation.css"');
    expect(cssEntry.indexOf('styles/theme.css')).toBeLessThan(cssEntry.indexOf('styles/foundation.css'));
    expect(cssEntry).toContain('@import "./styles/pickers.css"');
    expect(cssEntry.split("\n").length).toBeLessThan(30);
    expect(foundation).toMatch(/\.desktop-agent-boundary\s*\{[^}]*container:\s*desktop-agent \/ inline-size/s);
    expect(foundation).not.toMatch(/\.desktop-agent-panel\s*\{[^}]*container:/s);
    expect(foundation).toMatch(/\.desktop-agent-panel\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto/s);
    expect(foundation).toMatch(/\.desktop-agent-header-region,\s*\.desktop-agent-status-region,\s*\.desktop-agent-conversation-region,\s*\.desktop-agent-conversation-overlay,\s*\.desktop-agent-dock-region\s*\{[^}]*grid-column:\s*1/s);
    expect(foundation).toContain("--agent-radius-composer: 8px");
    expect(foundation).toContain("--agent-inline-inset: var(--desktop-sidebar-row-left-gap, 12px)");
    expect(foundation).toContain("--agent-composer-input-min-height: calc(var(--agent-composer-line-height) + var(--agent-composer-input-padding-block) + var(--agent-composer-input-padding-block));");
    expect(foundation).not.toContain("--agent-composer-input-min-height: 70px");
    expect(theme).toContain("--agent-composer-surface: var(--po-active)");
    expect(theme).toContain("--agent-user-message-surface: var(--po-hover)");
    expect(theme).toContain("--agent-user-message-border: color-mix(in srgb, var(--agent-border-subtle) 62%, transparent)");
    expect(theme).not.toContain("--agent-connection-surface");
    expect(theme).not.toContain("--agent-prompt-surface:");
    expect(foundation).not.toMatch(/--agent-(?:composer|user-message)-(?:surface|border):/);
    expect(pickers).toMatch(
      /\.desktop-agent-picker\.is-header \.desktop-agent-picker-trigger\s*\{[^}]*color:\s*var\(--desktop-titlebar-text-muted, var\(--po-text-muted\)\);[^}]*font-size:\s*var\(--po-type-header-content, 15px\);[^}]*font-weight:\s*var\(--po-font-weight-chrome, 500\);[^}]*line-height:\s*var\(--po-type-header-line-height, 20px\);/s,
    );
    expect(css).not.toContain("max-width: 759px");
    expect(css).toContain("max-width: 559px");
    expect(css).toContain("max-width: 419px");
    expect(css).toContain("prefers-reduced-motion");
    expect(globalLayout).not.toContain(".desktop-agent-");
    expect(composer).not.toContain("useLayoutEffect");
    expect(composer.split("\n").length).toBeLessThan(190);
    expect(composer).not.toContain("function ReferenceChip");
    expect(composer).toContain("<AgentCommandSuggestions");
    expect(composer).toContain("<AgentDraftReferenceList");
    expect(composer).toContain("<AgentComposerToolbar");
    expect(composerToolbar).toContain("<AgentAttachmentButton");
    expect(composerToolbar).toContain("<AgentSessionControlPicker");
    expect(composerToolbar).not.toMatch(/AgentModelPicker|AgentEffortPicker/);
    expect(sessionControlPicker).toContain('indicator="none"');
    expect(sessionControlPicker).not.toMatch(/codex|cursor|opencode|claude/i);
    expect(sessionControls).toContain("deriveAgentSessionControls");
    expect(sessionControls).not.toMatch(/codex|cursor|opencode|claude/i);
    expect(sessionControls).toContain('id: "mode"');
    expect(markdownDocument).not.toContain("useDeferredValue");
    expect(markdownDocument).toContain("splitStreamingMarkdown");
    expect(streamPresentation).toContain("nextAgentStreamText");
    expect(streamPresentation).not.toContain("useDeferredValue");
    expect(streamPolicy).toContain("TARGET_CATCH_UP_FRAMES");
    expect(eventSynchronizer).not.toMatch(/requestAnimationFrame|document\.|window\./);
    expect(eventSynchronizer).toContain("applyAgentDisplayPatch");
    expect(streamScheduler).toContain('typeof window.requestAnimationFrame === "function"');
    expect(streamScheduler).toContain("document.visibilityState !== \"hidden\"");
    expect(eventSynchronizer).toContain("assertAgentDisplay");
    expect(composerToolbar.split("\n").length).toBeLessThan(130);
    expect(attachmentButton).not.toMatch(/useState|DesktopOverlayLayer|role="menu"/);
    expect(commandSuggestions).not.toMatch(/useState|AgentSessionController/);
    expect(draftReferences).not.toMatch(/useState|AgentSessionController/);
    expect(composer).not.toMatch(/\.style(?:\.|\[)/);
    expect(composer).not.toContain("ResizeObserver");
    expect(composer).toContain("<AgentPromptEditor");
    expect(composer).not.toContain("onMouseDown=");
    expect(composer).not.toContain('querySelector(".cm-content")');
    expect(promptEditor).toContain("EditorView.atomicRanges");
    expect(promptEditor).toContain("class AgentPromptReferenceWidget extends WidgetType");
    expect(promptEditor).toContain("Decoration.replace");
    expect(promptEditor).not.toContain("Decoration.mark");
    expect(promptEditor).not.toContain("focusAtCoordinates");
    expect(promptEditor).not.toMatch(/mousedown\s*:/);
    expect(css).toMatch(/\.desktop-agent-prompt-editor \.cm-scroller\s*\{[^}]*max-height:\s*calc\(var\(--agent-composer-text-max-height\) \+ var\(--agent-composer-input-padding-block\) \+ var\(--agent-composer-input-padding-block\)\)[^}]*overflow-y:\s*auto/s);
    expect(composer).not.toContain("<select");
    expect(picker).toContain("DesktopOverlayLayer");
    expect(picker).toContain("useAnchoredOverlayPosition");
    expect(picker).toContain("DesktopMenuSurface");
    expect(picker).toContain("DesktopMenuSection");
    expect(picker).toContain("DesktopMenuItem");
    expect(picker).not.toMatch(/className\?: string|preferredWidth\?: number|showChevron\?: boolean/);
    expect(pickerPresentation).toContain('export type AgentPickerPlacement = "composer" | "header"');
    expect(pickerPresentation).toContain('export type AgentPickerWidth = "wide" | "medium" | "narrow"');
    expect(picker).toContain('placement = "composer"');
    expect(picker).toContain('placementPreference: placement === "composer" ? "above" : "below"');
    expect(picker).toContain("preferredWidth,\n              agentPickerMaxHeightPixels");
    expect(desktopMenu).toContain('tone?: "default" | "quiet"');
    expect(desktopMenu).toContain("forwardRef<HTMLButtonElement, DesktopMenuItemProps>");
    expect(timeline).not.toContain("style={{");
    expect(picker).not.toContain("style={{");
    expect(runtimeGeometry).toContain("Record<`--agent-${string}`");
    expect(runtimeGeometry).not.toMatch(/[,{]\s*(?:position|visibility|transform|transformOrigin|height|width|maxHeight|padding|margin|color|background|borderRadius)\s*:/);
  });

  it("keeps product-critical Agent performance scenarios in the benchmark suite", () => {
    const benchmark = source("benchmarks/performance/agent-chat.bench.ts");
    const app = source("src/App.tsx");
    expect(benchmark).toContain("128 KiB of safe Markdown");
    expect(benchmark).toContain("64 KiB command output and 240-line diff");
    expect(benchmark).toContain("500-model searchable picker");
    expect(benchmark).toContain("2,000-row transcript with bounded DOM");
    expect(app).toContain("loadAgentChatWorkbenchItem");
    expect(app).toContain("lazy(loadAgentChatWorkbenchItem)");
    expect(source("src/features/desktop-agent/lazy.ts")).toContain(
      'import("./workbench/AgentChatWorkbenchItem")',
    );
    expect(source("src/features/desktop-agent/workbench/AgentChatWorkbenchItem.tsx"))
      .toContain("<AgentChatTabPanel");
    expect(app).toContain("contributions={auxiliaryWorkbenchContributions}");
    expect(app).not.toContain('RightAgentPanel } from "./features/desktop-agent"');
  });

  it("keeps application behind an explicit client port and Electron access in the composition adapter", () => {
    const port = source("src/features/desktop-agent/application/AgentClientPort.ts");
    const controller = source("src/features/desktop-agent/application/AgentSessionController.ts");
    const adapter = source("src/features/desktop-agent/infrastructure/electron/electronAgentClient.ts");
    expect(port).toContain("export interface AgentClientPort");
    expect(controller).not.toMatch(/window\.|puppyoneDesktop|infrastructure\//);
    expect(adapter).toContain("window.puppyoneDesktop");
  });

  it("persists routing and native-session metadata, never PuppyOne Chat History", () => {
    const main = source("electron/main.mjs");
    const sessionCache = source("electron/main/agent/cache/ephemeral-agent-session-cache.mjs");
    const conversationCatalog = source("electron/main/agent/persistence/agent-conversation-catalog.mjs");
    const inventory = source("electron/main/agent/connections/local-agent-inventory.mjs");
    const preferences = source("src/features/app-shell/preferences.ts");
    const header = source("src/features/desktop-agent/ui/AgentSurfaceHeader.tsx");
    const controllerState = source("src/features/desktop-agent/application/agent-controller-state.ts");
    expect(main).toContain("createEphemeralAgentSessionCache");
    expect(main).toContain("createAgentConversationCatalog");
    expect(main).toContain("createAgentSessionRepository");
    expect(sessionCache).toContain("PuppyOne does not own Chat History");
    expect(sessionCache).not.toMatch(/promises\.writeFile|desktop-agent-sessions\.json.*write/);
    expect(conversationCatalog).toContain("metadata-only index");
    expect(conversationCatalog).not.toContain("events:");
    expect(conversationCatalog).toContain("return compact({");
    expect(conversationCatalog).toContain("providerSessionId,");
    expect(main).toContain("agent-runtime-inventory.json");
    expect(inventory).toContain("PERSISTED_CACHE_TTL_MS");
    expect(preferences).toContain("AGENT_ROUTING_PREFERENCES_STORAGE_KEY");
    expect(header).not.toMatch(/Session history|Recent chats|Archive chat|Delete local chat|Fork chat/);
    expect(controllerState).not.toContain("history:");
    expect(controllerState).toContain('AgentSubmissionStage = "preparing-session" | "starting-turn" | null');
  });

  it("separates History queries, prepared-session ownership, and optional Harness History operations", () => {
    const browser = source("src/features/desktop-agent/workbench/AgentChatHistoryBrowser.tsx");
    const historyController = source("src/features/desktop-agent/application/ConversationHistoryController.ts");
    const registry = source("src/features/desktop-agent/application/controllerRegistry.ts");
    const historyPort = source("electron/main/agent/runtime/agent-session-history-port.mjs");
    const indexer = source("electron/main/agent/application/history/native-conversation-indexer.mjs");
    const lifecycle = source("electron/main/agent/application/session/agent-session-lifecycle.mjs");

    expect(browser).toContain("new ConversationHistoryController");
    expect(browser).not.toMatch(/AgentSessionController|getAgentSessionController|controllerRegistry/);
    expect(historyController).toContain("operation = this.runRefresh");
    expect(historyController).toContain("generation === this.generation");
    expect(historyController).not.toMatch(/createAgentSession|resumeAgentSession|openAgentSession|onAgentEvent/);
    expect(registry).not.toMatch(/MAX_CONTROLLERS|trimInactiveControllers|hasSubscribers/);
    expect(registry).toContain("await controller.rollbackPreparation()");
    expect(historyPort).toContain("assertAgentSessionHistoryCapabilities");
    expect(indexer).toContain("resolveAgentSessionHistoryPort(adapter)");
    expect(lifecycle).toContain("hydrateAgentSession(session, emit)");
    expect(source("electron/main/agent/application/session/agent-history-hydration.mjs")).toContain("resolveAgentSessionHistoryPort(session.adapter)");
    expect(lifecycle).not.toMatch(/adapter\.readHistory/);
  });

  it("keeps native transport internals out of Renderer", () => {
    const preload = source("electron/preload.cjs");
    const renderer = [
      source("src/features/desktop-agent/ui/RightAgentPanel.tsx"),
      source("src/features/desktop-agent/application/AgentSessionController.ts"),
      source("src/features/desktop-agent/agentTypes.ts"),
    ].join("\n");
    expect(preload).not.toMatch(/spawnAgent|agentStdin|OpenCodeHttpClient|OPENCODE_SERVER_PASSWORD/);
    expect(renderer).not.toMatch(/OpenCodeHttpClient|OPENCODE_SERVER_PASSWORD|\/global\/event/);
  });

  it("models provider recovery as replaceable live state rather than transcript history", () => {
    const projection = source("electron/main/agent/domain/transcript/transcript-reducer.mjs");
    const typedProjection = source("electron/main/agent/domain/transcript/display-projection.mjs");
    const notice = source("src/features/desktop-agent/ui/activity/AgentNoticeActivity.tsx");
    const connection = source("src/features/desktop-agent/ui/AgentConnectionStatus.tsx");
    const codex = source("electron/main/agent/runtimes/codex/codex-events.mjs");
    const claude = source("electron/main/agent/runtimes/claude/claude-events.mjs");
    expect(projection).toContain('case "provider.connection.updated"');
    expect(typedProjection).toContain('event.type === "provider.connection.updated"');
    expect(notice).not.toContain("recoverable");
    expect(notice).not.toContain("desktop-agent-spin");
    expect(connection).toContain('data-state={status.state}');
    expect(codex).toContain('type: params.willRetry ? "provider.connection.updated" : "provider.error"');
    expect(claude).toContain('event("provider.connection.updated"');
  });

  it("uses one terminal lifecycle authority and a provider-neutral semantic Renderer registry", () => {
    const lifecycle = source("electron/main/agent/domain/transcript/turn-lifecycle.mjs");
    const projection = source("electron/main/agent/domain/transcript/transcript-reducer.mjs");
    const typedProjection = source("electron/main/agent/domain/transcript/display-projection.mjs");
    const renderer = source("src/features/desktop-agent/ui/AgentPartRenderer.tsx");
    const registry = source("src/features/desktop-agent/ui/AgentPartRendererRegistry.tsx");

    expect(lifecycle).toContain("reconcileTerminalAgentTurn");
    expect(lifecycle).toContain("LIVE_AGENT_ACTIVITY_STATUSES");
    expect(projection).toContain("reconcileTerminalAgentTurn(next, event)");
    expect(projection).not.toContain("LIVE_ACTIVITY_STATUSES");
    expect(typedProjection).toContain("agentTurnTerminalState(event)");
    expect(typedProjection).not.toContain("isLiveActivityStatus");
    expect(registry).toContain("AgentPartByKind");
    expect(registry).toContain("registerAgentPartRenderer");
    expect(renderer).toContain("resolveAgentPartRenderer(props.part.kind)");
    expect(renderer).not.toMatch(/provider\s*===|switch\s*\(.*provider/i);
  });

  it("keeps Core backend-neutral and concrete backends in the single production composition root", () => {
    const registry = source("electron/main/agent/runtime/agent-runtime-registry.mjs");
    const bootstrap = source("electron/main/agent/bootstrap/create-agent-runtime-host.mjs");
    const reservedPuppyOneRuntime = source("electron/main/agent/runtimes/puppyone-agent/puppyone-agent-runtime-definition.mjs");
    const contract = source("shared/agent-contract/schema.mjs");
    expect(registry).not.toMatch(/opencode|codex|claude|cursor/i);
    expect(bootstrap).not.toContain("createPuppyOneAgentRuntimeDefinition");
    expect(bootstrap).not.toContain('"puppyone-agent"');
    expect(reservedPuppyOneRuntime).toContain("createPuppyOneAgentRuntimeDefinition");
    expect(bootstrap).toContain("createCodexRuntimeDefinition");
    expect(bootstrap).toContain("createClaudeRuntimeDefinition");
    expect(bootstrap).toContain("createOpenCodeNativeRuntimeDefinition");
    expect(bootstrap).toContain("createPiRuntimeDefinition");
    expect(bootstrap).toContain("createCursorRuntimeDefinition");
    expect(bootstrap).toContain('DEFAULT_AGENT_RUNTIME_ID = "codex"');
    expect(contract).toContain("parseAgentIpcRequest");
    expect(contract).toContain("assertAgentIpcResponse");
  });

  it("keeps ACP generic, Cursor extensions isolated and native starts supervised", () => {
    const acpCore = source("electron/main/agent/protocols/acp/acp-runtime-adapter.mjs");
    const cursor = source("electron/main/agent/runtimes/cursor/cursor-acp-adapter.mjs");
    const cursorDiscovery = source("electron/main/agent/runtimes/cursor/cursor-discovery.mjs");
    const claude = source("electron/main/agent/runtimes/claude/claude-identity.mjs");
    const main = source("electron/main.mjs");
    expect(acpCore).not.toMatch(/cursor\/|managedOpenCodeAcpConfig|OPENCODE_/);
    expect(cursor).toContain('authenticationMethodId: "cursor_login"');
    expect(cursor).toContain('questionMethods: ["cursor/ask_question"]');
    expect(cursorDiscovery).toContain('compatibility: "acp-v1"');
    expect(cursorDiscovery).toContain('status: "ready"');
    expect(claude).toContain('displayName: "Claude Agent"');
    expect(main).toContain("createAgentProcessSupervisor");
    expect(main).toContain("agentProcessSupervisor");
  });

  it("keeps ACP lifecycle generic and OpenCode policy/runtime selection explicit", () => {
    const adapter = source("electron/main/agent/runtimes/opencode-protocol/opencode-acp-adapter.mjs");
    const acpCore = source("electron/main/agent/protocols/acp/acp-runtime-adapter.mjs");
    const controller = source("src/features/desktop-agent/application/AgentSessionController.ts");
    const panel = source("src/features/desktop-agent/ui/AgentChatTabPanel.tsx");
    expect(adapter).toContain("extends AcpRuntimeAdapter");
    expect(adapter).toContain("managedOpenCodeAcpConfig");
    expect(acpCore).toContain("client.newSession");
    expect(acpCore).toContain("resolveAcpModels");
    expect(acpCore).toContain("publicProviders");
    expect(acpCore).toContain("PuppyOne deliberately does not");
    expect(controller).toContain("selectedProviderId");
    expect(panel.indexOf("agentRuntimes=")).toBeLessThan(panel.indexOf("sessionControls="));
    expect(panel).toContain("conversation={<AgentRuntimeLauncher");
    expect(panel).not.toContain("<AgentRuntimePicker");
    expect(source("src/features/desktop-agent/ui/AgentComposer.tsx")).not.toContain("AgentRuntimePicker");
  });

  it("keeps local executable inventory main-owned, lazy and separate from OpenCode provider authority", () => {
    const inventory = source("electron/main/agent/connections/local-agent-inventory.mjs");
    const candidates = source("electron/main/agent/connections/probes/executable-candidates.mjs");
    const controller = source("src/features/desktop-agent/application/AgentSessionController.ts");
    const runtimePicker = source("src/features/desktop-agent/ui/AgentRuntimePicker.tsx");
    const backendRouting = source("src/features/desktop-agent/domain/agent-backend-routing.ts");
    const registry = source("electron/main/agent/connections/tools/local-agent-tool-registry.mjs");
    expect(inventory).not.toMatch(/from ["']react|OpenCode|providerCatalog/);
    expect(candidates).not.toMatch(/-ilc|login shell|exec\(/i);
    expect(controller.indexOf("discoverLocalConnections")).toBeGreaterThan(controller.indexOf("initialize(refresh"));
    expect(runtimePicker).not.toMatch(/Local tools|AgentLocalConnection|connection\.id/);
    expect(runtimePicker).not.toMatch(/Coding Agents|Detected|Refresh/);
    expect(runtimePicker).toContain("A non-ready runtime remains inspectable");
    expect(backendRouting).not.toMatch(/puppyone-agent|codex|claude|cursor|opencode/i);
    expect(registry).toContain("validateDescriptor");
  });
});

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function agentStyles() {
  return ["theme", "foundation", "transcript", "activities", "blocking", "composer", "pickers", "responsive"]
    .map((name) => source(`src/features/desktop-agent/ui/styles/${name}.css`))
    .join("\n");
}
