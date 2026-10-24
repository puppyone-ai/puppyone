// Settings pixel references: the real product SettingsDialog, one page per
// scenario, in an offline page. Fixture data mirrors `src/lab.rs`
// (`settings-*` cases) exactly: default preferences, an English system
// language, a development build, a project at /reference/project, no Cloud
// session, the lab's detected local Agents and an empty model catalog.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@puppyone/localization/react";
import { initializeDesktopPreferences } from "PRODUCT/src/preferencesStore";
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
const section = fixture.id.replace(/-(dark|light)$/u, "");
const NOW = 1_800_000_000_000;
Date.now = () => NOW;

const LOCAL_AGENT_IDS = ["claude", "codex", "cursor", "opencode", "pi", "workbuddy-china"];
const noop = () => {};
Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: {
  getPlatformCapabilities: async () => ({ platform: "macos" }),
  getBuildInfo: async () => ({ channel: "dev", version: "0.1.0", buildId: "reference", commitSha: "reference", builtAt: "2026-10-24T00:00:00.000Z", sourceDirty: false }),
  discoverLocalAgentInstallations: async () => ({
    schemaVersion: 1, generation: 1, scanId: "reference-scan:1",
    requestedAt: "2026-10-24T00:00:00.000Z", completedAt: "2026-10-24T00:00:00.001Z", source: "scan",
    availableAgentIds: LOCAL_AGENT_IDS,
    results: LOCAL_AGENT_IDS.map((agentId) => ({ agentId, displayName: agentId, status: "found", source: "fixture" })),
  }),
  onLocalAgentInstallationProgress: () => noop,
  onLocalAgentInstallationsChanged: () => noop,
} });
initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });

const workspace = { id: "reference", name: "project", path: "/reference/project" };

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
    git={{ status: null, loading: false, error: null, refresh: noop }}
    cloud={{ enabled: true, session: null, sessionRestoring: false, apiBaseUrl: null, onSessionChange: noop }}
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
