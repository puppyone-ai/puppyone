// Cloud pixel references: the real product Cloud surfaces in an offline page.
// Data comes from `fixtures/cloud-history.json` (`window.__fixtureData`),
// which `src/lab.rs` (`cloud-*` cases) reads too; Cloud requests are
// answered by a fixture bridge, so nothing leaves the page.
//
// - `history-list` / `history-detail` / `history-empty`: the Cloud Header's
//   History sidebar (`CloudWorkspaceHistorySidebar`).
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@puppyone/localization/react";
import { initializeDesktopPreferences } from "PRODUCT/src/preferencesStore";
import { CloudWorkspaceHistorySidebar } from "PRODUCT/src/features/cloud/history/CloudWorkspaceHistorySidebar";

declare global {
  interface Window {
    fixture: { id: string; mode: "light" | "dark"; locale: string; width: number; height: number };
    __catalogs: Record<string, Record<string, string>>;
    __fixtureData: any;
    __referenceReady?: boolean;
  }
}

const fixture = window.fixture;
const data = window.__fixtureData;
const scenario = fixture.id.replace(/-(dark|light)$/u, "");
document.head.insertAdjacentHTML("beforeend", "<style>html,body,#root{min-width:0!important}</style>");
document.documentElement.dataset.poScrollbarMode = "product";
// One clock for both sides: relative times and the day groups.
const RealDate = Date;
class FixtureDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(data.now);
    else super(...(args as [number]));
  }
  static now() { return data.now; }
}
window.Date = FixtureDate as DateConstructor;
initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });

const page = scenario === "history-empty" ? data.empty : data.page;
Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: {
  getPlatformCapabilities: async () => ({ platform: "macos" }),
  requestCloudSessionApi: async ({ path }: { path: string }) => path.includes("/commit-detail") ? data.detail : page,
  cancelCloudSessionApi: async () => {},
} });
const session = { user_id: "reference-user", session_generation: 1, api_base_url: data.api, email: "reference@example.test" };
const noop = () => {};

function Fixture() {
  useEffect(() => {
    const timer = setTimeout(() => { window.__referenceReady = true; }, 600);
    return () => clearTimeout(timer);
  }, []);
  return <div style={{ position: "absolute", inset: 0, display: "flex" }}>
    <CloudWorkspaceHistorySidebar session={session as never} projectId={data.page.project_id}
      apiBaseUrl={data.api} active revisionKey="reference" onSessionChange={noop} onClose={noop} />
  </div>;
}

const catalogs = window.__catalogs;
const initialState = { locale: fixture.locale, preference: "system", direction: "ltr", systemLanguages: ["en-US"] };
const localization = { initialState, initialCatalog: catalogs[fixture.locale], fallbackCatalog: catalogs.en,
  loadCatalog: async (locale: string) => ({ catalog: catalogs[locale], fallbackCatalog: catalogs.en }),
  client: { onLocaleChanged: () => () => {}, setLanguagePreference: async (preference: string) => ({ ...initialState, preference, locale: preference }) } };
createRoot(document.getElementById("root")!).render(<LocalizationProvider {...(localization as never)}><Fixture /></LocalizationProvider>);
