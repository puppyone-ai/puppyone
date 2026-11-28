// Settings pixel references: the real product SettingsDialog, one page per
// scenario, in an offline page. Fixture data mirrors `src/lab.rs`
// (`settings-*` cases) exactly: default preferences, an English system
// language, a development build, a project at /reference/project, no Cloud
// session, the lab's detected local Agents and an empty model catalog.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@puppyone/localization/react";
import { desktopPreferencesStore, initializeDesktopPreferences } from "PRODUCT/src/preferencesStore";
import { SettingsDialog } from "PRODUCT/src/features/settings/SettingsDialog";
import { useSubThemeCatalog } from "PRODUCT/src/features/themes/useSubThemeCatalog";

declare global {
  interface Window {
    fixture: { id: string; mode: "light" | "dark"; locale: string; width: number; height: number };
    __catalogs: Record<string, Record<string, string>>;
    __referenceReady?: boolean;
  }
}

const fixture = window.fixture;
document.head.insertAdjacentHTML("beforeend", "<style>html,body,#root{min-width:0!important}</style>");
document.documentElement.dataset.poScrollbarMode = "product";
const scenario = fixture.id.replace(/-(dark|light)$/u, "");
// `git-remotes` is the Git page over a repository with remotes.
const WITH_REMOTES = scenario === "git-remotes";
// `agent-hooks`: Local Agents with the Codex Hook installed and the setup
// directory open; `agent-activation`: the Codex activation dialog over it.
const AGENT_SETUP = scenario === "agent-hooks" || scenario === "agent-activation";
const section = WITH_REMOTES ? "git" : AGENT_SETUP ? "local-agents" : scenario;
// The product portals Settings into the overlay root, so a dialog opened
// from it stacks above; this page renders Settings in #root instead.
if (scenario === "agent-activation") document.head.insertAdjacentHTML("beforeend", "<style>#desktop-overlay-root{z-index:1300}</style>");
const NOW = 1_800_000_000_000;
Date.now = () => NOW;

const LOCAL_AGENT_IDS = ["claude", "codex", "cursor", "opencode", "pi", "workbuddy-china"];
// `setupRegistry` on darwin (electron/main/local-agent-catalog), sorted by name.
const SETUP_ROUTES = [
  { id: "claude", displayName: "Claude Code", strategy: "external-cli", publisher: "Claude Code", terminal: true, version: null },
  { id: "codex", displayName: "Codex", strategy: "external-cli", publisher: "OpenAI", terminal: true, version: "0.155.1" },
  { id: "cursor", displayName: "Cursor Agent", strategy: "external-cli", publisher: "Cursor", terminal: true, version: "2026.09.18-9a7762b" },
  { id: "hermes", displayName: "Hermes Agent", strategy: "companion-managed-runtime", publisher: "Hermes Agent", terminal: true, version: null },
  { id: "opencode", displayName: "OpenCode", strategy: "external-cli", publisher: "OpenCode", terminal: true, version: null },
  { id: "pi", displayName: "Pi Agent", strategy: "external-cli", publisher: "Pi Agent", terminal: true, version: null },
  { id: "workbuddy-china", displayName: "WorkBuddy (China)", strategy: "app-bundled-runtime", publisher: "WorkBuddy (China)", terminal: false, version: null },
  { id: "workbuddy-international", displayName: "WorkBuddy (International)", strategy: "app-bundled-runtime", publisher: "WorkBuddy (International)", terminal: false, version: null },
];
const noop = () => {};
const MODEL_SNAPSHOT = { schemaVersion: 1, revision: 1, connections: [], catalogs: [],
  managed: { available: false, reason: "sign-in-required", signedIn: false } };
Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: {
  getPlatformCapabilities: async () => ({ platform: "macos" }),
  // A fresh development build: Basic by default, never asked, never sent
  // (`telemetry::fixture(Level::Basic, false, true)` in src/lab.rs).
  getTelemetryState: async () => ({ schemaVersion: 2, defaultLevel: "basic", level: "basic", effectiveLevel: "off",
    enabled: false, eligible: false, disabledReason: "unpackaged-build", noticeVersion: 2, noticeSeenVersion: 0,
    noticeRequired: false, transportConfigured: false, queuedEventCount: 0 }),
  onTelemetryStateChanged: () => noop,
  getBuildInfo: async () => ({ channel: "dev", version: "0.1.0", buildId: "reference", commitSha: "reference", builtAt: "2026-10-24T00:00:00.000Z", sourceDirty: false }),
  discoverLocalAgentInstallations: async () => ({
    schemaVersion: 1, generation: 1, scanId: "reference-scan:1",
    requestedAt: "2026-10-24T00:00:00.000Z", completedAt: "2026-10-24T00:00:00.001Z", source: "scan",
    availableAgentIds: LOCAL_AGENT_IDS,
    results: LOCAL_AGENT_IDS.map((agentId) => ({ agentId, displayName: agentId, status: "found", source: "fixture" })),
  }),
  onLocalAgentInstallationProgress: () => noop,
  onLocalAgentInstallationsChanged: () => noop,
  // Hook registration as a fresh machine reports it (`hook-registration-service.mjs`):
  // the three configurable providers are detected and not configured.
  getAgentActivityEnrollment: async () => ({ schemaVersion: 1, providers: [
    { providerId: "codex", displayName: "Codex", configurable: true, enrollment: AGENT_SETUP ? "enabled" : "not-configured" },
    { providerId: "claude", displayName: "Claude Code", configurable: true, enrollment: "not-configured" },
    { providerId: "cursor", displayName: "Cursor Agent CLI", configurable: true, enrollment: "not-configured" },
    { providerId: "opencode", displayName: "OpenCode", configurable: false, enrollment: "basic-only" },
    { providerId: "pi", displayName: "Pi Agent", configurable: false, enrollment: "basic-only" },
    { providerId: "hermes", displayName: "Hermes Agent", configurable: false, enrollment: "basic-only" },
  ] }),
  setAgentActivityEnrollment: async () => ({ ok: true }),
  // Setup guides as `setup-service.mjs` projects them for the fixture: the
  // platform's Chat routes, the detected Agents found, no companion apps.
  localAgentSetup: {
    inspect: async (request: { eligibleInstallationIds: string[]; surface: string }) => ({
      revision: "reference", installationGeneration: 1,
      entries: SETUP_ROUTES.filter((route) => request.eligibleInstallationIds.includes(route.id)
        && (request.surface === "chat" || route.terminal)).map((route) => ({
        setupId: route.id, installationId: route.id, displayName: route.displayName, strategy: route.strategy,
        status: LOCAL_AGENT_IDS.includes(route.id) ? "found" : "not-found", companionPresent: false, recommended: false,
      })),
    }),
    act: async () => ({ status: "guide-opened" }),
    release: async () => {},
  },
  // No operations yet; Codex has its reviewed darwin-arm64 recipe.
  localAgentActivation: {
    read: async () => ({ epoch: "reference", revision: 0, operations: [] }),
    plan: async ({ setupId, surface }: { setupId: string; surface: string }) => {
      const route = SETUP_ROUTES.find((entry) => entry.id === setupId)!;
      return { planId: "reference-plan", setupId, displayName: route.displayName,
        mode: route.version ? "automatic" : "guided", version: route.version, publisher: route.publisher, surface };
    },
    start: async () => ({ epoch: "reference", revision: 0, operations: [] }),
    act: async () => ({ epoch: "reference", revision: 0, operations: [] }),
    openGuide: async () => {},
    subscribe: () => noop,
  },
  // An empty model connection store with the managed gateway signed out.
  modelConnections: {
    read: async () => ({ ok: true, value: MODEL_SNAPSHOT }),
    discover: async () => ({ ok: true, value: [] }),
    subscribe: () => noop,
    managed: async () => ({ ok: true, value: MODEL_SNAPSHOT }),
    save: async () => ({ ok: true, value: MODEL_SNAPSHOT }),
    remove: async () => ({ ok: true, value: MODEL_SNAPSHOT }),
    refresh: async () => ({ ok: true, value: MODEL_SNAPSHOT }),
    verify: async () => ({ ok: true, value: MODEL_SNAPSHOT }),
  },
} });
initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
// Cloud follows the experiment, off by default; only Plan (`seats`), which
// exists only with Cloud on, turns it on (the native lab does the same).
const CLOUD_ENABLED = scenario === "seats";
if (CLOUD_ENABLED) desktopPreferencesStore.getState().setExperimentalSettings((current) => ({ ...current, enableCloudWorkspace: true }));

const workspace = { id: "reference", name: "project", path: "/reference/project" };
// `RepositoryInfo` of the native lab: one commit on `main`, no upstream; the
// `git-remotes` case adds a PuppyOne project remote and a GitHub remote whose
// push URL differs from its fetch URL.
const HEAD = "4f2c9a1e7b3d5c6a8e9f0b1c2d3e4f5a6b7c8d9e";
const REMOTES = WITH_REMOTES ? [
  { name: "origin", fetchUrl: "https://git.puppyone.ai/git/p7k2m9x4.git", pushUrl: "https://git.puppyone.ai/git/p7k2m9x4.git",
    branches: ["origin/main", "origin/dev"] },
  { name: "github", fetchUrl: "git@github.com:acme/desktop.git", pushUrl: "https://github.com/acme/desktop.git",
    branches: ["github/main"] },
] : [];
const REMOTE_BRANCHES = REMOTES.flatMap((remote) => remote.branches).map((name) => ({ name, current: false, remote: true,
  upstream: null, ahead: 0, behind: 0, lastCommitId: HEAD, lastCommitMessage: "Initial commit", lastCommitDate: "2026-10-24T00:00:00.000Z" }));
const GIT_STATUS = {
  isRepo: true, branch: "main", headCommitId: HEAD, totalCommits: 1,
  entries: [], stagedEntries: [], unstagedEntries: [], untrackedEntries: [],
  branches: [{ name: "main", current: true, remote: false, upstream: null, ahead: 0, behind: 0,
    lastCommitId: HEAD, lastCommitMessage: "Initial commit", lastCommitDate: "2026-10-24T00:00:00.000Z" }, ...REMOTE_BRANCHES],
  remotes: REMOTES, syncTarget: null,
  effectiveHosting: { kind: "local-only", remoteName: null, branchName: "main", ref: null, ready: false, reason: "local-only", identity: null },
  sourceControl: { input: { placeholder: "", defaultMessage: "" }, groups: [], operation: null,
    remote: { kind: "none" }, actions: { canStageAll: false, canUnstageAll: false, canDiscardAll: false, canCommit: false } },
  commits: [], allCommits: [], statusLimit: 0, didHitStatusLimit: false,
};

function Fixture() {
  const [active, setActive] = useState(section as never);
  const subThemeCatalog = useSubThemeCatalog();
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const find = (selector: string, text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
      .find((button) => button.textContent?.trim() === text);
    // Click `text` once it exists, then continue.
    const clickWhenReady = (selector: string, text: string, then: () => void, tries = 40) => {
      const button = find(selector, text);
      if (button) { button.click(); timers.push(setTimeout(then, 150)); return; }
      if (tries > 0) timers.push(setTimeout(() => clickWhenReady(selector, text, then, tries - 1), 100));
    };
    // The setup section ends the page: scroll it into view (the native lab
    // scrolls the page to its end too).
    const ready = (delay: number) => timers.push(setTimeout(() => {
      if (AGENT_SETUP) document.querySelectorAll<HTMLElement>(".desktop-settings-body").forEach((body) => { body.scrollTop = body.scrollHeight; });
      timers.push(setTimeout(() => { window.__referenceReady = true; }, 150));
    }, delay));
    if (AGENT_SETUP) {
      // Open the directory, then (activation) Codex's dialog, as a person would.
      clickWhenReady(".local-agent-setup button[aria-expanded]", "Set up Agents", () => {
        if (scenario === "agent-activation") clickWhenReady(".local-agent-setup-directory button", "Codex", () => ready(400));
        else ready(400);
      });
    } else ready(400);
    return () => timers.forEach(clearTimeout);
  }, []);
  return <SettingsDialog
    onClose={noop}
    workspace={workspace as never}
    activeSection={active}
    onSelectSection={setActive}
    onOpenImport={noop}
    subThemeCatalog={subThemeCatalog}
    onFilesVisibilityChange={noop}
    git={{ status: GIT_STATUS as never, loading: false, error: null, refresh: noop }}
    cloud={{ enabled: CLOUD_ENABLED, session: null, sessionRestoring: false, apiBaseUrl: null, onSessionChange: noop }}
    workspaceConfig={{ value: null, loading: false, saving: false, error: null, change: async () => null, unlink: async () => {} }}
    updates={{
      state: { status: "disabled", channel: "dev", blockers: [], currentVersion: "0.1.0" } as never,
      check: noop, install: noop,
      automaticDownloadPreferenceAvailable: true, automaticDownloadPreferenceSaving: false,
      automaticDownloadPreferenceError: false, setAutomaticallyDownloadUpdates: noop,
    }}
  />;
}

const catalogs = window.__catalogs;
const initialState = { locale: fixture.locale, preference: "system", direction: "ltr", systemLanguages: ["en-US"] };
const localization = { initialState, initialCatalog: catalogs[fixture.locale], fallbackCatalog: catalogs.en,
  loadCatalog: async (locale: string) => ({ catalog: catalogs[locale], fallbackCatalog: catalogs.en }),
  client: { onLocaleChanged: () => () => {}, setLanguagePreference: async (preference: string) => ({ ...initialState, preference, locale: preference }) } };
createRoot(document.getElementById("root")!).render(<LocalizationProvider {...(localization as never)}><Fixture /></LocalizationProvider>);
