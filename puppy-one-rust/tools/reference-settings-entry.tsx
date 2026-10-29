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
const section = WITH_REMOTES ? "git" : scenario;
const NOW = 1_800_000_000_000;
Date.now = () => NOW;

const LOCAL_AGENT_IDS = ["claude", "codex", "cursor", "opencode", "pi", "workbuddy-china"];
const noop = () => {};
const MODEL_SNAPSHOT = { schemaVersion: 1, revision: 1, connections: [], catalogs: [],
  managed: { available: false, reason: "sign-in-required", signedIn: false } };
Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: {
  getPlatformCapabilities: async () => ({ platform: "macos" }),
  // The native build has no telemetry client: analytics report off.
  getTelemetryState: async () => ({ level: "off", noticeRequired: false }),
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
    { providerId: "codex", displayName: "Codex", configurable: true, enrollment: "not-configured" },
    { providerId: "claude", displayName: "Claude Code", configurable: true, enrollment: "not-configured" },
    { providerId: "cursor", displayName: "Cursor Agent CLI", configurable: true, enrollment: "not-configured" },
    { providerId: "opencode", displayName: "OpenCode", configurable: false, enrollment: "basic-only" },
    { providerId: "pi", displayName: "Pi Agent", configurable: false, enrollment: "basic-only" },
    { providerId: "hermes", displayName: "Hermes Agent", configurable: false, enrollment: "basic-only" },
  ] }),
  setAgentActivityEnrollment: async () => ({ ok: true }),
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
    const timer = setTimeout(() => { window.__referenceReady = true; }, 400);
    return () => clearTimeout(timer);
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
