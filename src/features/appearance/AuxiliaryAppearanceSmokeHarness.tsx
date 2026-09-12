import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { AuxiliaryWorkbenchPanel } from "../app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { ProjectWorkbenchStore } from "../app-shell/auxiliary-workbench/ProjectWorkbenchStore";
import type {
  AuxiliaryWorkbenchContribution,
  AuxiliaryWorkbenchItemRenderContext,
  AuxiliaryWorkbenchProject,
} from "../app-shell/auxiliary-workbench/types";
import { DesktopOverlayPortal } from "../app-shell/DesktopOverlayPortal";
import { TerminalRuntimePool } from "../desktop-terminal/runtime/TerminalRuntimePool";
import { TerminalSessionView } from "../desktop-terminal/ui/TerminalSessionView";
import { readTerminalAppearance, type TerminalAppearance } from "../desktop-terminal/runtime/terminalAppearance";
import { AgentComposer } from "../desktop-agent/ui/AgentComposer";
import { AgentPickerPopover } from "../desktop-agent/ui/AgentPickerPopover";
import { AuxiliaryWorkbenchLauncher } from "../app-shell/auxiliary-workbench/AuxiliaryWorkbenchLauncher";
import { AgentConversationHistory } from "../desktop-agent/ui/AgentConversationHistory";
import { AGENT_CHAT_CREATION_RECIPES } from "../app-shell/auxiliary-workbench/agentChatCreationRecipes";
import { resolveAppearance } from "./resolveAppearance";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider, useSurfaceAppearance } from "./AppearanceRuntime";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "../typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../markdown/markdownPresentation";
import type { TerminalAppearanceRequest, TerminalCreateRequest, TerminalDataEvent } from "../../types/electron";
import "../desktop-agent/ui/desktop-agent.css";
import "../desktop-terminal/ui/desktop-terminal.css";
import "./auxiliary-appearance-smoke.css";

type Theme = "light" | "dark" | "windows-xp";
const initialTheme = new URLSearchParams(location.search).get("theme") as Theme || "light";
const headerMotion = new URLSearchParams(location.search).has("header-motion");
const creations: TerminalCreateRequest[] = [];
const updates: TerminalAppearanceRequest[] = [];
const outputs = new Set<(event: TerminalDataEvent) => void>();
const input = { text: "" };
const fixtureResponse = "A response uses the application's text and surface roles.";

// Deterministic CLI fixture: explicit RGB composer derived from startup colors.
// It exercises the production terminal runtime without credentials or a native process.
Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: {
  locateTerminalAgents: async () => ({ availableAgentIds: ["codex", "cursor"], scannedAt: "2026-09-11T00:00:00.000Z", source: "scan" }),
  onTerminalAgentLocationProgress: () => () => {},
  createTerminal: async (request: TerminalCreateRequest) => {
    creations.push(request);
    const bg = request.defaultColors!.background.map(channel => Math.max(0, channel - 10));
    const data = "\x1b[2J\x1b[HReady\r\n\x1b[48;2;" + bg.join(";") + "m Input from the CLI                    \x1b[0m\r\n";
    outputs.forEach(listener => listener({ id: request.id, data }));
    return { id: request.id, instanceId: request.id, shell: "/bin/zsh", inputShell: "/bin/zsh" };
  },
  onTerminalData: (listener: (event: TerminalDataEvent) => void) => { outputs.add(listener); return () => outputs.delete(listener); },
  onTerminalExit: () => () => {},
  updateTerminalAppearance: (request: TerminalAppearanceRequest) => updates.push(request),
  resizeTerminal: () => {},
  writeTerminal: (request: { data: string }) => { input.text += request.data; },
  closeTerminal: async () => {},
} });

function ChatFixture() {
  const { t } = useLocalization();
  const [draft, setDraft] = useState("Draft survives theme changes");
  return <div className="desktop-agent-boundary">
    <div className="auxiliary-smoke-chat">
      <AgentPickerPopover placeholder={t("agent.model.placeholder")} valueLabel={t("agent.model.placeholder")} ariaLabel={t("agent.model.placeholder")} groups={[{ id: "models", label: t("agent.model.models"), options: [{ id: "fixture", label: "Fixture model", selected: true, selectable: true }] }]} onSelect={() => {}} />
      <p className="desktop-agent-message">{fixtureResponse}</p>
      <AgentComposer draft={draft} onDraftChange={setDraft} disabled={false} running={false} stopping={false} submitting={false} onSubmit={async () => true} onStop={() => {}} />
    </div>
  </div>;
}

// This fixture tests renderer appearance with a deterministic CLI transport.
// Production workbench contributions now create native hosts; their process and
// presentation lifecycle is covered by the real project-session smoke instead.
function TerminalFixture({ project, item, presentation, readAppearance }: AuxiliaryWorkbenchItemRenderContext & {
  readAppearance: () => TerminalAppearance;
}) {
  const appearance = useSurfaceAppearance();
  const pool = project.getResource<TerminalRuntimePool>("appearance-terminals", () => { throw new Error("Terminal fixture was not prepared."); });
  const entry = pool.get(item.id)!;
  useEffect(() => {
    const frame = requestAnimationFrame(() => entry.runtime.applyAppearance(readAppearance()));
    return () => cancelAnimationFrame(frame);
  }, [appearance, entry, readAppearance]);
  return <TerminalSessionView runtime={entry.runtime} workspacePath={project.context.rootPath}
    presented={presentation.presented} focused={presentation.commandTarget} />;
}

export function AuxiliaryAppearanceSmokeHarness() {
  const { t } = useLocalization();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [width, setWidth] = useState(560);
  const [active, setActive] = useState(true);
  const surface = useRef<HTMLDivElement>(null);
  const [store] = useState(() => new ProjectWorkbenchStore({ projectId: "appearance", rootPath: "/fixture/project", generation: "appearance" }));
  const appearance = useMemo(() => resolveSurfaceAppearance({
    appearance: resolveAppearance({ interfaceStyle: theme === "windows-xp" ? "windows-xp" : "default", themeMode: theme === "dark" ? "dark" : "light", sidebarNavigationLayout: "bottom-horizontal", fileIconTheme: "default" }),
    typography: resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
    loadingAnimationPreset: "ikun", lightThemePreset: "neutral", darkThemePreset: "default", pointerCursors: false, diffMarkers: "color",
  }), [theme]);
  const readAppearance = useCallback(() => readTerminalAppearance(surface.current!), []);
  const contributions = useMemo(() => {
    const chat: AuxiliaryWorkbenchContribution = {
      kind: "agent-chat", label: "Chat", createLabel: "Chat", minimumSize: { width: 280, height: 260 },
      initialSnapshot: { title: headerMotion ? "Codex" : "Chat", accessibleLabel: "Chat", detail: null, iconKey: headerMotion ? "codex" : null, status: "idle", running: false, resourceId: null },
      creationRecipes: headerMotion ? AGENT_CHAT_CREATION_RECIPES : undefined,
      history: headerMotion ? {
        label: t("agent.history.title"), iconKey: "history",
        renderBrowser: ({ onBack, onOpen }) => <div className="desktop-agent-boundary desktop-agent-runtime-launcher is-history">
          <AgentConversationHistory
            sessions={["Review sidebar architecture", "Fix terminal startup", "A longer conversation title to verify narrow history rows"].map((title, index) => ({
              id: `fixture-history-${index}`, runtimeId: index === 1 ? "cursor" : "codex", provider: index === 1 ? "cursor" : "codex",
              providerSessionId: `native-${index}`, workspaceRoot: "/fixture/project", title,
              createdAt: "2026-09-11T10:00:00.000Z", updatedAt: "2026-09-11T10:00:00.000Z",
              lastSequence: 0, terminalState: "idle" as const, selectedModel: null,
            }))}
            runtimes={[]} loading={false} refreshing={false} loadingMore={false} hasMore={false} error={null}
            sources={{ codex: { runtimeId: "codex", status: "complete", coverage: "unknown", indexed: 3, nextCursor: null, scanId: null, warnings: [] } }}
            onBack={onBack} onRefresh={() => {}} onLoadMore={() => {}}
            onOpen={(session) => onOpen({ id: session.id, title: session.title, iconKey: session.runtimeId ?? null, payload: {} })}
          />
        </div>,
      } : undefined,
      renderItem: () => <ChatFixture />,
      close: { decide: () => ({ kind: "close" }), commit: async () => true },
    };
    const terminalPool = (project: AuxiliaryWorkbenchProject) => project.getResource("appearance-terminals", () => new TerminalRuntimePool(project, t));
    const terminal: AuxiliaryWorkbenchContribution = {
      ...chat, kind: "terminal", label: "Terminal", createLabel: "Terminal",
      initialSnapshot: { ...chat.initialSnapshot, title: "Terminal", accessibleLabel: "Terminal", iconKey: "shell" },
      creationRecipes: [{ id: "shell", label: "Terminal", iconKey: "shell", status: "available" }],
      history: undefined,
      prepare: async ({ project, item }) => { if (!headerMotion) terminalPool(project).ensure(item.id, "shell", readAppearance()); },
      discardPreparedItem: async ({ project, item }) => { if (!headerMotion) await terminalPool(project).close(item.id); },
      renderItem: context => headerMotion ? <div className="desktop-terminal-session">{t("terminal.title")}</div>
        : <TerminalFixture {...context} readAppearance={readAppearance} />,
      close: { decide: () => ({ kind: "close" }), commit: async ({ project, item }) => headerMotion || terminalPool(project).close(item.id) },
    };
    return [terminal, chat];
  }, [t, readAppearance]);
  useLayoutEffect(() => {
    document.documentElement.dataset.interfaceStyle = theme === "windows-xp" ? "windows-xp" : "default";
  }, [theme]);
  useEffect(() => {
    let cancelled = false;
    let started = false;
    const start = async () => {
      const terminal = await store.create("terminal", null, contributions[0].creationRecipes!.find(recipe => recipe.id === "shell")!);
      if (cancelled) return;
      const chatRecipe = contributions[1].creationRecipes?.[0] ?? null;
      const chat = await store.create("agent-chat", null, chatRecipe);
      if (cancelled) return;
      if (!terminal || !chat) throw new Error("Appearance fixture could not create contributions.");
      const group = store.getSnapshot().topology.groups[0].id;
      const api = {
        creations, updates, input, setTheme, setWidth, setActive,
        snapshot: store.getSnapshot,
        activateItem: (itemId: string) => store.dispatch({ type: "activate", itemId }),
        closeItem: store.removeItem,
        newChat: () => store.create("agent-chat", null, chatRecipe),
        newLauncher: () => store.createLauncher(null, t("workspace.workbench.newTab")),
        promoteLauncher: (launcherId: string) => store.create("agent-chat", null, chatRecipe, null, launcherId),
        activate: (kind: "terminal" | "chat") => store.dispatch({ type: "activate", itemId: kind === "terminal" ? terminal : chat }),
        split: () => store.dispatch({ type: "split-item", sourceItemId: chat, targetGroupId: group, edge: "bottom", groupId: "chat-group", splitId: "appearance-split" }),
        newTerminal: () => store.create("terminal", null, contributions[0].creationRecipes!.find(recipe => recipe.id === "shell")!),
      };
      Object.assign(window, { __auxiliaryAppearanceSmoke: api });
    };
    // Do not start/dispose persistent resources during StrictMode's effect probe.
    const timer = setTimeout(() => { started = true; void start(); }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (started) store.dispose();
      Reflect.deleteProperty(window, "__auxiliaryAppearanceSmoke");
    };
  }, [store, contributions, t]);
  return <SurfaceAppearanceProvider value={appearance}>
    <main {...appearance.rootProps} className={theme === "dark" ? "dark desktop-theme-preview-surface auxiliary-appearance-smoke" : "desktop-theme-preview-surface auxiliary-appearance-smoke"}>
      <div className="desktop-right-sidebar is-open auxiliary-appearance-smoke-sidebar" style={{ width }}>
        <div ref={surface} className="desktop-right-sidebar-stack">
          <AuxiliaryWorkbenchPanel store={store} contributions={contributions} active={active} renderLauncher={(context) => headerMotion ? <AuxiliaryWorkbenchLauncher
            {...context} store={store} contributions={contributions} hiddenAgentIds={[]}
          /> : null} />
        </div>
      </div>
      <DesktopOverlayPortal appearance={appearance}>{null}</DesktopOverlayPortal>
    </main>
  </SurfaceAppearanceProvider>;
}
