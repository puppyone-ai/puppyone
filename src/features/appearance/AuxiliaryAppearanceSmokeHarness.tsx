import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { AuxiliaryWorkbenchPanel } from "../app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { ProjectWorkbenchStore } from "../app-shell/auxiliary-workbench/ProjectWorkbenchStore";
import type {
  AuxiliaryWorkbenchContribution,
  AuxiliaryWorkbenchItemRenderContext,
  AuxiliaryWorkbenchProject,
} from "../app-shell/auxiliary-workbench/types";
import { DesktopOverlayPortal } from "../app-shell/DesktopOverlayPortal";
import { DESKTOP_TERMINAL_LAUNCHERS } from "../desktop-terminal/model/terminalLaunchers";
import { TerminalRuntimePool } from "../desktop-terminal/runtime/TerminalRuntimePool";
import {
  readTerminalAppearance,
  type TerminalAppearance,
} from "../desktop-terminal/runtime/terminalAppearance";
import { useTerminalAppearanceSync } from "../desktop-terminal/runtime/useTerminalAppearanceSync";
import { TerminalSessionView } from "../desktop-terminal/ui/TerminalSessionView";
import { AgentComposer } from "../desktop-agent/ui/AgentComposer";
import { AgentPickerPopover } from "../desktop-agent/ui/AgentPickerPopover";
import { resolveAppearance } from "./resolveAppearance";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "./AppearanceRuntime";
import { DEFAULT_TYPOGRAPHY_PREFERENCES, resolveTypography } from "../typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../markdown/markdownPresentation";
import type { TerminalAppearanceRequest, TerminalCreateRequest, TerminalDataEvent } from "../../types/electron";
import "../desktop-agent/ui/desktop-agent.css";
import "./auxiliary-appearance-smoke.css";

type Theme = "light" | "dark" | "windows-xp";
const initialTheme = new URLSearchParams(location.search).get("theme") as Theme || "light";
const creations: TerminalCreateRequest[] = [];
const updates: TerminalAppearanceRequest[] = [];
const outputs = new Set<(event: TerminalDataEvent) => void>();
const input = { text: "" };
const fixtureResponse = "A response uses the application's text and surface roles.";

// Deterministic CLI fixture: explicit RGB composer derived from startup colors.
// It exercises the production terminal runtime without credentials or a native process.
Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: {
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

function createSmokeTerminalContribution(
  t: MessageFormatter,
  readAppearance: () => TerminalAppearance,
): AuxiliaryWorkbenchContribution {
  return {
    kind: "terminal",
    label: t("terminal.title"),
    createLabel: t("terminal.new"),
    minimumSize: { width: 280, height: 260 },
    maximumItems: 32,
    initialSnapshot: {
      title: t("terminal.title"),
      accessibleLabel: t("terminal.title"),
      detail: null,
      iconKey: null,
      status: "starting",
      running: false,
      resourceId: null,
    },
    creationRecipes: DESKTOP_TERMINAL_LAUNCHERS.map((launcher) => ({
      id: launcher.id,
      label: t(launcher.nameMessage),
      iconKey: launcher.id,
      status: "available",
    })),
    prepare: async ({ project, item, recipe }) => {
      const launcher = DESKTOP_TERMINAL_LAUNCHERS.find((entry) => entry.id === recipe?.id);
      if (!launcher) throw new Error("Unknown terminal launcher.");
      getSmokeTerminalPool(project, t).ensure(item.id, launcher.id, readAppearance());
    },
    discardPreparedItem: async ({ project, item }) => {
      if (!project.disposed) await getSmokeTerminalPool(project, t).close(item.id);
    },
    renderItem: (context) => (
      <SmokeTerminalItem {...context} t={t} readAppearance={readAppearance} />
    ),
    close: {
      decide: () => ({ kind: "close" }),
      commit: ({ project, item }) => getSmokeTerminalPool(project, t).close(item.id),
    },
  };
}

function SmokeTerminalItem({
  project,
  item,
  presentation,
  t,
  readAppearance,
}: AuxiliaryWorkbenchItemRenderContext & {
  t: MessageFormatter;
  readAppearance: () => TerminalAppearance;
}) {
  const entry = getSmokeTerminalPool(project, t).get(item.id);
  if (!entry) throw new Error("Appearance fixture terminal is missing.");
  useTerminalAppearanceSync(entry.runtime, readAppearance);
  return (
    <div className="desktop-terminal-session-host-content">
      <TerminalSessionView
        runtime={entry.runtime}
        workspacePath={item.rootId}
        presented={presentation.presented}
        focused={presentation.commandTarget}
      />
    </div>
  );
}

function getSmokeTerminalPool(project: AuxiliaryWorkbenchProject, t: MessageFormatter) {
  return project.getResource(
    "appearance-smoke-terminal",
    () => new TerminalRuntimePool(project, t),
  );
}

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
      initialSnapshot: { title: "Chat", accessibleLabel: "Chat", detail: null, iconKey: null, status: "idle", running: false, resourceId: null },
      renderItem: () => <ChatFixture />,
      close: { decide: () => ({ kind: "close" }), commit: async () => true },
    };
    return [createSmokeTerminalContribution(t, readAppearance), chat];
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
      const chat = await store.create("agent-chat", null);
      if (cancelled) return;
      if (!terminal || !chat) throw new Error("Appearance fixture could not create contributions.");
      const group = store.getSnapshot().topology.groups[0].id;
      const api = {
        creations, updates, input, setTheme, setWidth, setActive,
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
  }, [store, contributions]);
  return <SurfaceAppearanceProvider value={appearance}>
    <main {...appearance.rootProps} className={theme === "dark" ? "dark desktop-theme-preview-surface auxiliary-appearance-smoke" : "desktop-theme-preview-surface auxiliary-appearance-smoke"}>
      <div className="desktop-right-sidebar is-open auxiliary-appearance-smoke-sidebar" style={{ width }}>
        <div ref={surface} className="desktop-right-sidebar-stack">
          <AuxiliaryWorkbenchPanel store={store} contributions={contributions} active={active} renderLauncher={() => null} />
        </div>
      </div>
      <DesktopOverlayPortal appearance={appearance}>{null}</DesktopOverlayPortal>
    </main>
  </SurfaceAppearanceProvider>;
}
