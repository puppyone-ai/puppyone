// Real product right-sidebar composition for pixel references (bundled by
// reference-workbench.mjs). `PRODUCT/` is replaced with the product checkout.
// AuxiliaryWorkbenchPanel, its header/tabs, the launcher and the Agent Chat
// composition (AgentPanelLayout → AgentTranscript / docks / AgentComposer) are
// the production components; only data and services are fixtures. The same
// fixture data lives in src/features/workbench/lab.rs for the native capture.
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@puppyone/localization/react";
import { bidiIsolate } from "@puppyone/localization/core";
import { initializeDesktopPreferences } from "PRODUCT/src/preferencesStore";
import { AuxiliaryWorkbenchPanel } from "PRODUCT/src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { ProjectWorkbenchStore } from "PRODUCT/src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";
import { AuxiliaryWorkbenchLauncher } from "PRODUCT/src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchLauncher";
import { AGENT_CHAT_CREATION_RECIPES } from "PRODUCT/src/features/app-shell/auxiliary-workbench/agentChatCreationRecipes";
import { DesktopOverlayPortal } from "PRODUCT/src/features/app-shell/DesktopOverlayPortal";
import { resolveAppearance } from "PRODUCT/src/features/appearance/resolveAppearance";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "PRODUCT/src/features/appearance/AppearanceRuntime";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "PRODUCT/src/features/typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "PRODUCT/src/features/markdown/markdownPresentation";
import { AgentPanelLayout } from "PRODUCT/src/features/desktop-agent/ui/AgentPanelLayout";
import { AgentTranscript } from "PRODUCT/src/features/desktop-agent/ui/AgentTranscript";
import { AgentComposer } from "PRODUCT/src/features/desktop-agent/ui/AgentComposer";
import { AgentEmptyState } from "PRODUCT/src/features/desktop-agent/ui/AgentEmptyState";
import { AgentApprovalDock } from "PRODUCT/src/features/desktop-agent/ui/AgentApprovalDock";
import { AgentQuestionDock } from "PRODUCT/src/features/desktop-agent/ui/AgentQuestionDock";
import { createEmptyAgentDisplay } from "PRODUCT/shared/agent-contract/display-state.mjs";
import { AgentChatHistoryBrowser } from "PRODUCT/src/features/desktop-agent/workbench/AgentChatHistoryBrowser";
import { AgentConversationHistory } from "PRODUCT/src/features/desktop-agent/ui/AgentConversationHistory";
import { createAgentChatCloseAdapter } from "PRODUCT/src/features/desktop-agent/workbench/agentChatCloseAdapter";
import { TerminalSessionHeaderStatus } from "PRODUCT/src/features/desktop-terminal/ui/session-header/TerminalSessionHeaderStatus";
import "PRODUCT/src/features/desktop-agent/ui/desktop-agent.css";
import "PRODUCT/src/features/desktop-terminal/ui/desktop-terminal.css";

declare global {
  interface Window {
    fixture: { id: string; mode: "light" | "dark"; locale: string; width: number; height: number };
    __catalogs: Record<string, Record<string, string>>;
    __referenceReady?: boolean;
  }
}

const fixture = window.fixture;
// The reference viewport is the sidebar itself, narrower than the app window minimum.
document.head.insertAdjacentHTML("beforeend", "<style>html,body,#root{min-width:0!important}</style>");
// index.html: product scrollbars reserve their 12px gutter.
document.documentElement.dataset.poScrollbarMode = "product";
const scenario = fixture.id.replace(/-(dark|light)$/u, "");
// Frozen clock: running-turn elapsed labels are part of the reference.
const NOW = 1_800_000_000_000;
Date.now = () => NOW;

const LOCAL_AGENT_IDS = ["claude", "codex", "cursor", "opencode", "pi", "workbuddy-china"];
Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: {
  getPlatformCapabilities: async () => ({ platform: "macos" }),
  discoverLocalAgentInstallations: async () => ({
    schemaVersion: 1, generation: 1, scanId: "reference-scan:1",
    requestedAt: "2026-10-24T00:00:00.000Z", completedAt: "2026-10-24T00:00:00.001Z", source: "scan",
    availableAgentIds: LOCAL_AGENT_IDS,
    results: LOCAL_AGENT_IDS.map((agentId) => ({ agentId, displayName: agentId, status: "found", source: "fixture" })),
  }),
  onLocalAgentInstallationProgress: () => () => {},
  onLocalAgentInstallationsChanged: () => () => {},
} });
initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });

type Part = Record<string, unknown> & { id: string; kind: string; turnId: string | null; sequence: number };
type Turn = { id: string; status: string; startedAtSequence: number; startedAtMs: number; completedAtSequence: number | null; durationMs: number | null; partIds: string[] };

/** Main-process display shape: parts + rows, with confirmed turn summaries. */
function display(parts: Part[], turns: Turn[], running: string | null) {
  const value = createEmptyAgentDisplay() as ReturnType<typeof createEmptyAgentDisplay> & Record<string, unknown>;
  value.sessionState = "active";
  const allParts: Part[] = [...parts];
  const rows = parts.map((part) => ({ id: `row:${part.id}`, partId: part.id, turnId: part.turnId, kind: part.kind,
    sequence: part.sequence, updatedSequence: part.sequence, estimatedHeight: 40 }));
  for (const turn of turns) {
    if (turn.status === "running" || turn.durationMs === null || turn.completedAtSequence === null) continue;
    const last = Math.max(...rows.filter((row) => row.turnId === turn.id).map((row) => row.sequence));
    const id = `turn-summary:${turn.id}`;
    allParts.push({ id, kind: "turn-summary", turnId: turn.id, itemId: null, durationMs: turn.durationMs, status: turn.status, sequence: Math.max(turn.completedAtSequence, last) });
    rows.push({ id: `row:${id}`, partId: id, turnId: turn.id, kind: "turn-summary", sequence: Math.max(turn.completedAtSequence, last), updatedSequence: turn.completedAtSequence, estimatedHeight: 34 });
  }
  rows.sort((left, right) => left.sequence - right.sequence);
  value.parts = allParts as never;
  value.rows = rows as never;
  value.turns = turns as never;
  value.lastSequence = Math.max(0, ...parts.map((part) => part.sequence));
  value.runningTurnId = running;
  value.terminalState = running ? null : "completed";
  return value;
}

const USER_1 = "Make the terminal colours follow the theme.";
const ANSWER_1 = [
  "Two follow-ups:",
  "",
  "- Keep a soft divider beside the transcript.",
  "- Colours stay theme-owned.",
  "",
  "| Layer | Owner |",
  "| --- | --- |",
  "| Terminal | Theme pack |",
  "| Chat | Agent UI |",
].join("\n");
const USER_2 = "Give the editor equal padding.";
const ANSWER_2 = "Changed `padding` to `24px` so both axes match.";

function transcriptParts(runningTools: boolean): Part[] {
  const status = runningTools ? "running" : "completed";
  return [
    { id: "user:1", kind: "user", turnId: "turn-1", itemId: null, text: USER_1, streaming: false, terminalState: null, sequence: 1 },
    { id: "assistant:1", kind: "assistant", turnId: "turn-1", itemId: "message-1", text: ANSWER_1, streaming: false, terminalState: "completed", sequence: 2 },
    { id: "user:2", kind: "user", turnId: "turn-2", itemId: null, text: USER_2, streaming: false, terminalState: null, sequence: 3 },
    { id: "reasoning:1", kind: "reasoning", turnId: "turn-2", itemId: "reasoning-1", label: "Thought briefly", status: "completed",
      detail: { delta: "Located the editor surface padding and compared both axes." }, output: "", sequence: 4 },
    { id: "compaction:1", kind: "tool", turnId: "turn-2", itemId: "compact-1", label: "Compacted context", status: "completed",
      detail: { tool: "compaction" }, output: "", sequence: 5 },
    { id: "tool:grep", kind: "tool", turnId: "turn-2", itemId: "tool-grep", label: "Search padding", status,
      detail: { tool: "grep", input: { pattern: "padding", path: "src" } },
      output: "src/markdown-editor.css:42:padding: 12px 24px;\nsrc/editor-shell.css:18:padding-inline: 24px;", sequence: 6 },
    { id: "tool:command", kind: "command", turnId: "turn-2", itemId: "tool-command", label: "Search owners", status: "completed",
      detail: { tool: "bash", input: { command: "rg -n padding src/markdown-editor.css" }, metadata: { exitCode: 0, duration: 2080 } },
      output: "42:  padding: 12px 24px;", sequence: 7 },
    { id: "tool:read", kind: "tool", turnId: "turn-2", itemId: "tool-read", label: "Read markdown-editor.css", status,
      detail: { tool: "read", input: { file_path: "src/markdown-editor.css" } },
      output: ".markdown-editor {\n  padding: 12px 24px;\n}", sequence: 8 },
    { id: "tool:edit", kind: "file-change", turnId: "turn-2", itemId: "tool-edit", label: "Updated markdown-editor.css", status: "completed",
      detail: { tool: "edit", path: "src/markdown-editor.css", changes: [{ path: "src/markdown-editor.css", additions: 1, deletions: 1,
        diff: "@@ -42,1 +42,1 @@\n-  padding: 12px 24px;\n+  padding: 24px;",
        blocks: [{ removed: "  padding: 12px 24px;", added: "  padding: 24px;" }] }] },
      output: "", sequence: 9 },
    { id: "assistant:2", kind: "assistant", turnId: "turn-2", itemId: "message-2", text: ANSWER_2, streaming: false, terminalState: "completed", sequence: 10 },
  ];
}
const COMPLETED_TURNS: Turn[] = [
  { id: "turn-1", status: "completed", startedAtSequence: 1, startedAtMs: NOW - 120_000, completedAtSequence: 2, durationMs: 2_400, partIds: ["user:1", "assistant:1"] },
  { id: "turn-2", status: "completed", startedAtSequence: 3, startedAtMs: NOW - 90_000, completedAtSequence: 10, durationMs: 31_000, partIds: ["user:2", "assistant:2"] },
];

function projectionFor(id: string) {
  if (id === "chat-empty" || id === "tabs-narrow" || id === "close-dialog") return createEmptyAgentDisplay();
  if (id === "chat-transcript" || id === "chat-tool-expanded") return display(transcriptParts(false), COMPLETED_TURNS, null);
  // Running: turn 2 is still working, its tools are live and no summary exists.
  const parts = transcriptParts(true).filter((part) => part.id !== "assistant:2");
  const turns: Turn[] = [COMPLETED_TURNS[0], { id: "turn-2", status: "running", startedAtSequence: 3, startedAtMs: NOW - 12_000, completedAtSequence: null, durationMs: null, partIds: ["user:2"] }];
  const value = display(parts, turns, "turn-2");
  if (id === "chat-approval") value.approvals = [APPROVAL] as never;
  if (id === "chat-question") value.questions = [QUESTION] as never;
  return value;
}

const APPROVAL = {
  requestId: "reference-approval", turnId: "turn-2", itemId: "tool-command", kind: "command",
  title: "Run rg -n padding src", command: "rg -n padding src", cwd: "/reference/project", commandActions: [],
  networkApprovalContext: null, grantRoot: null, policyChangeRequested: false,
  reason: "Search the project for padding declarations", availableDecisions: ["accept", "acceptForSession", "decline", "cancel"], sequence: 11,
};
const QUESTION = {
  requestId: "reference-question", turnId: "turn-2", itemId: null, sequence: 11,
  questions: [{ header: "Padding", question: "Which padding should the editor use?", multiple: false, custom: true,
    options: [{ label: "24px on every side", description: "Match the horizontal padding" }, { label: "Keep 12px vertical", description: "Only widen the sides" }] }],
};

const CONTROLS = [
  { id: "model", value: "gpt-5.4", options: [{ value: "gpt-5.4", label: "GPT-5.4" }, { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" }] },
  { id: "effort", value: "medium", options: ["low", "medium", "high"].map((value) => ({ value, label: value })) },
  { id: "mode", value: "code", options: [{ value: "code", label: "Code" }, { value: "plan", label: "Plan" }] },
] as const;

function translate(key: string, values?: Record<string, unknown>) {
  const message = window.__catalogs[fixture.locale]?.[key] ?? key;
  return message.replace(/\{(\w+)\}/gu, (_match, name) => String(values?.[name] ?? ""));
}

function FixtureChat() {
  const t = translate;
  const [draft, setDraft] = useState("");
  const projection = useMemo(() => projectionFor(scenario), []);
  const running = projection.runningTurnId !== null && projection.runningTurnId !== undefined;
  const empty = scenario === "chat-empty" || scenario === "tabs-narrow" || scenario === "close-dialog";
  const approval = scenario === "chat-approval" ? APPROVAL : null;
  const question = scenario === "chat-question" ? QUESTION : null;
  return <AgentPanelLayout
    ariaLabel={t("agent.panel.chat", { agent: bidiIsolate("Codex") })}
    phase="ready"
    conversationOverlay={empty ? <AgentEmptyState runtimeIconKey="codex" runtimeLabel="Codex" /> : null}
    conversation={<AgentTranscript projection={projection as never} loading={false} working={running} runtimeLabel="Codex" />}
    dock={<>
      {approval && <AgentApprovalDock approval={approval as never} queueLength={1} resolving={false} runtimeLabel="Codex" onResolve={() => {}} />}
      {question && <AgentQuestionDock request={question as never} queueLength={1} resolving={false} onResolve={() => {}} />}
      <AgentComposer
        draft={draft} onDraftChange={setDraft} disabled={Boolean(approval || question)}
        running={running} stopping={false} submitting={false}
        placeholder={t(empty ? "agent.composer.placeholder.default" : "agent.composer.placeholder.followUp")}
        runtimeLabel="Codex" sessionControls={CONTROLS as never} onSelectSessionControl={() => {}}
        commands={[]} references={[]} onSubmit={async () => true} onStop={() => {}}
      />
    </>}
  />;
}

// history-list: the cross-runtime browser after discovery was allowed. The
// session data mirrors `HistoryBrowser::lab_fixture` in the native lab.
const HISTORY_RUNTIMES = [["codex", "Codex"], ["claude", "Claude Code"], ["pi", "Pi"], ["opencode", "OpenCode"]] as const;
const HISTORY_SESSIONS = [
  ["codex", "Make the terminal colours follow the theme", 5 * 60_000],
  ["claude", "Refactor the workbench split constraints", 2 * 3_600_000],
  ["codex", "Port the approval dock to GPUI", 26 * 3_600_000],
  ["pi", "Investigate the flaky terminal resize test after the PTY host moved", 3 * 86_400_000],
  ["opencode", "Audit markdown table rendering", 9 * 86_400_000],
] as const;

function FixtureHistory({ context }: { context: Record<string, unknown> }) {
  if (scenario === "history-permission") {
    return <AgentChatHistoryBrowser {...(context as never)} historyDiscoveryEnabled={false} onHistoryDiscoveryEnabledChange={() => {}} />;
  }
  const runtimes = HISTORY_RUNTIMES.map(([id, displayName]) => ({ descriptor: { id, displayName, iconKey: id }, readiness: { status: "ready" } }));
  const sessions = HISTORY_SESSIONS.map(([runtimeId, title, age], index) => ({
    id: `history-${index}`, runtimeId, runtime: null, provider: runtimeId, providerSessionId: `native-${index}`, workspaceRoot: "/reference/project",
    title, createdAt: new Date(NOW - age).toISOString(), updatedAt: new Date(NOW - age).toISOString(), terminalState: "idle",
    selectedModel: null, lastSequence: 0,
  }));
  const sources = Object.fromEntries(HISTORY_RUNTIMES.map(([id]) => [id, { runtimeId: id, status: "complete", coverage: "complete", nextCursor: null, scanId: null, indexed: 0, warnings: [] }]));
  return <div className="desktop-agent-boundary desktop-agent-runtime-launcher is-history">
    <AgentConversationHistory sessions={sessions as never} runtimes={runtimes as never} loading={false} refreshing={false}
      loadingMore={false} hasMore error={null} sources={sources as never} openingSessionId={null}
      onOpen={() => {}} onRefresh={() => {}} onLoadMore={() => {}} onBack={() => {}} />
  </div>;
}

function Fixture() {
  const [store] = useState(() => new ProjectWorkbenchStore({ projectId: "reference", rootPath: "/reference/project", generation: "reference" }));
  const appearance = useMemo(() => resolveSurfaceAppearance({
    appearance: resolveAppearance({ interfaceStyle: "default", themeMode: fixture.mode, sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default" }),
    typography: resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
    loadingAnimationPreset: "ikun", lightThemePreset: "neutral", darkThemePreset: "default", pointerCursors: false, diffMarkers: "color",
  }), []);
  const contributions = useMemo(() => {
    const chat = {
      kind: "agent-chat", label: "Chat", createLabel: "Chat", minimumSize: { width: 280, height: 260 },
      initialSnapshot: { title: "Codex", accessibleLabel: "Codex", detail: null, iconKey: "codex", status: "idle", running: false, resourceId: null },
      creationRecipes: AGENT_CHAT_CREATION_RECIPES,
      // The production chat contribution always offers History beside the launcher heading.
      history: { label: "History", iconKey: "history", renderBrowser: (context: never) => <FixtureHistory context={context} /> },
      renderItem: () => <FixtureChat />,
      // close-dialog: the chat is mid-turn, so closing asks first (`createAgentChatCloseAdapter`).
      // The tab keeps its idle status so the backdrop covers the chat-empty frame.
      close: scenario === "close-dialog"
        ? { ...createAgentChatCloseAdapter(translate, async () => true),
          decide: ({ snapshot }: { snapshot: Record<string, unknown> }) =>
            createAgentChatCloseAdapter(translate, async () => true).decide({ snapshot: { ...snapshot, running: true } } as never) }
        : { decide: () => ({ kind: "close" }), commit: async () => true },
    };
    const terminal = {
      ...chat, kind: "terminal", label: "Terminal", createLabel: "Terminal",
      initialSnapshot: { ...chat.initialSnapshot, title: "Terminal", accessibleLabel: "Terminal", iconKey: "shell" },
      creationRecipes: [{ id: "shell", label: "Terminal", iconKey: "shell", status: "available" }],
      renderItem: () => <div className="desktop-terminal-session" />,
      // Production terminals report their status through TerminalSessionHeaderStatus.
      renderStatus: () => <TerminalSessionHeaderStatus className="desktop-terminal-tab-status" runtime={null}
        session={{ launcherId: "shell", status: "running" } as never} />,
    };
    return [terminal, chat] as never[];
  }, []);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (scenario === "launcher" || scenario.startsWith("history-")) {
        store.createLauncher(null, "New tab");
      } else {
        const codex = AGENT_CHAT_CREATION_RECIPES.find((recipe) => recipe.id === "codex")!;
        const chat = await store.create("agent-chat", null, codex as never);
        const shell = (contributions[0] as { creationRecipes: never[] }).creationRecipes[0];
        await store.create("terminal", null, shell);
        store.createLauncher(null, "New tab");
        if (scenario === "tabs-narrow") {
          await store.create("agent-chat", null, AGENT_CHAT_CREATION_RECIPES.find((recipe) => recipe.id === "claude") as never);
          await store.create("terminal", null, shell);
        }
        if (chat) store.dispatch({ type: "activate", itemId: chat } as never);
      }
      if (cancelled) return;
      await new Promise((resolve) => setTimeout(resolve, 400));
      window.__referenceReady = true;
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [store, contributions]);
  return <SurfaceAppearanceProvider value={appearance}>
    <main {...appearance.rootProps} className={fixture.mode === "dark" ? "dark" : undefined}
      style={{ position: "absolute", inset: 0, display: "flex" }}>
      <div className="desktop-right-sidebar is-open"
        style={{ width: "100%", height: "100%", ["--desktop-right-sidebar-width" as string]: `${fixture.width}px` }}>
        <div className="desktop-right-sidebar-stack">
          <div className="desktop-right-sidebar-surface is-active">
            <AuxiliaryWorkbenchPanel store={store} contributions={contributions} active
              renderLauncher={(context) => <AuxiliaryWorkbenchLauncher {...context} store={store} contributions={contributions} />} />
          </div>
        </div>
      </div>
      <DesktopOverlayPortal appearance={appearance}>{null}</DesktopOverlayPortal>
    </main>
  </SurfaceAppearanceProvider>;
}

const catalogs = window.__catalogs;
const initialState = { locale: fixture.locale, preference: fixture.locale, direction: "ltr", systemLanguages: [] };
const localization = { initialState, initialCatalog: catalogs[fixture.locale], fallbackCatalog: catalogs.en,
  loadCatalog: async (locale: string) => ({ catalog: catalogs[locale], fallbackCatalog: catalogs.en }),
  client: { onLocaleChanged: () => () => {}, setLanguagePreference: async (preference: string) => ({ ...initialState, preference, locale: preference }) } };
createRoot(document.getElementById("root")!).render(<LocalizationProvider {...(localization as never)}><Fixture /></LocalizationProvider>);
