// Shell pixel references (`tools/shell-scenarios.json`): the real product
// feedback dialog (`DesktopHelpLauncher`) and empty Homepage
// (`MinimalOnboarding`) in an offline page. Fixture data mirrors `src/lab.rs`
// (`shell-*` cases): default preferences, no projects, Cloud off, and a
// packaged Stable build that has not shown the analytics notice yet.
//
// - `feedback`: the dialog as it opens; `-filled` with a message, an email
//   and `fixtures/feedback/screenshot.png`; `-sent` after Send succeeds;
//   `-error` after Send fails (a message and an email, no screenshot).
// - `coachmark-agent` / `-changes`: `HeaderFeatureCoachmark` open below an
//   entry box fixed at (1236, 6) 28×28; only the overlay is compared.
// - `home-empty`: after the intro, with the disclosure; `home-intro-*` hold
//   the intro at `fixture.intro` milliseconds.
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { LocalizationProvider } from "@puppyone/localization/react";
import {
  desktopPreferencesStore,
  initializeDesktopPreferences,
  useDesktopAppearance,
  useDesktopPreference,
} from "PRODUCT/src/features/settings";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "PRODUCT/src/features/appearance/AppearanceRuntime";
import { TypographyCatalogProvider, useTypographyCatalog, useTypographyRuntime } from "PRODUCT/src/features/typography";
import { DesktopHelpLauncher } from "PRODUCT/src/features/app-shell/DesktopHelpLauncher";
import { MinimalOnboarding } from "PRODUCT/src/components/MinimalOnboarding";
import { HeaderFeatureCoachmark } from "PRODUCT/src/features/app-shell/HeaderFeatureCoachmark";

declare global {
  interface Window {
    fixture: { id: string; mode: "light" | "dark"; locale: string; width: number; height: number; intro: number | null };
    __catalogs: Record<string, Record<string, string>>;
    __fixtureData: string | null;
    __referenceReady?: boolean;
  }
}

const fixture = window.fixture;
const scenario = fixture.id.replace(/-(dark|light)$/u, "");
const FEEDBACK = scenario.startsWith("feedback");
const COACHMARK = scenario.startsWith("coachmark-") ? (scenario.slice("coachmark-".length) as "agent" | "changes") : null;
const noop = () => {};
// A packaged Stable build before the first-run notice (`DesktopTelemetryState`).
const TELEMETRY = { schemaVersion: 2, defaultLevel: "basic", level: "basic", effectiveLevel: "off", enabled: false,
  eligible: true, disabledReason: "notice-required", noticeVersion: 2, noticeSeenVersion: 0, noticeRequired: true,
  transportConfigured: true, queuedEventCount: 0 };
Object.defineProperty(window, "puppyoneDesktop", { configurable: true, value: {
  getPlatformCapabilities: async () => ({ platform: "macos", windowChrome: { mode: "native-inset", supportsDockIcon: true } }),
  getTelemetryState: async () => TELEMETRY,
  onTelemetryStateChanged: () => noop,
  // Marking the notice seen keeps this launch's disclosure in place.
  markTelemetryNoticeSeen: async () => ({ ...TELEMETRY, noticeSeenVersion: 2, noticeRequired: false }),
  openExternalUrl: async () => ({ ok: true }),
  submitFeedback: scenario === "feedback-error"
    ? async () => { throw new Error("offline"); }
    : async () => ({ ok: true }),
} });

// The intro's fallback timer must not end a held frame.
if (fixture.intro !== null) {
  const setTimeoutBase = window.setTimeout.bind(window);
  window.setTimeout = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) =>
    delay === 1_400 ? 0 : setTimeoutBase(handler, delay, ...rest)) as typeof window.setTimeout;
}

initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
desktopPreferencesStore.getState().setThemeMode(fixture.mode);
// The launcher button lives in the sidebar footer; only its dialog is compared.
document.head.insertAdjacentHTML("beforeend", "<style>.desktop-help-launcher{visibility:hidden}</style>");

/** Type into a React-controlled field. */
function type(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!field) throw new Error(`Missing ${selector}`);
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function prepareFeedback() {
  await wait(50);
  document.querySelector<HTMLButtonElement>(".desktop-help-launcher")!.click();
  await wait(200);
  if (scenario === "feedback") return;
  type(".desktop-feedback-composer textarea", "The sidebar flickers when I resize the window.");
  type(".desktop-feedback-contact-input", "person@example.com");
  if (scenario === "feedback-error") {
    document.querySelector<HTMLFormElement>(".desktop-feedback-form")!.requestSubmit();
    await wait(300);
    return;
  }
  const bytes = Uint8Array.from(atob(window.__fixtureData!), (c) => c.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], "screenshot.png", { type: "image/png" }));
  const input = document.querySelector<HTMLInputElement>(".desktop-feedback-file-input")!;
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(300);
  if (scenario === "feedback-sent") {
    document.querySelector<HTMLFormElement>(".desktop-feedback-form")!.requestSubmit();
    await wait(300);
  }
}

function useFixtureAppearance() {
  const { resolvedAppearance, lightThemePreset, darkThemePreset } = useDesktopAppearance();
  const markdownPresentation = useDesktopPreference((s) => s.markdownPresentation);
  const pointerCursors = useDesktopPreference((s) => s.pointerCursors);
  const diffMarkers = useDesktopPreference((s) => s.diffMarkers);
  const typographyPreferences = useDesktopPreference((s) => s.typographyPreferences);
  const catalog = useTypographyCatalog();
  const typography = useTypographyRuntime(typographyPreferences, catalog, fixture.locale);
  return resolveSurfaceAppearance({ appearance: resolvedAppearance, typography, markdownPresentation,
    lightThemePreset, darkThemePreset, pointerCursors, diffMarkers } as never);
}

function Coachmark({ feature }: { feature: "agent" | "changes" }) {
  const appearance = useFixtureAppearance();
  return <SurfaceAppearanceProvider value={appearance}>
    <div style={{ position: "fixed", left: 1236, top: 6, width: 28, height: 28 }}>
      <HeaderFeatureCoachmark feature={feature} open onDismiss={noop} onPrimary={noop}>
        <span style={{ display: "block", width: 28, height: 28 }} />
      </HeaderFeatureCoachmark>
    </div>
  </SurfaceAppearanceProvider>;
}

function Home() {
  const appearance = useFixtureAppearance();
  return <SurfaceAppearanceProvider value={appearance}>
    <MinimalOnboarding appearance={appearance} projectItems={[]}
      onChooseWorkspace={async () => {}}
      onChooseProjectLocation={async () => null}
      onDefaultProjectLocation={async () => null}
      onCreateProject={async () => { throw new Error("fixture"); }}
      onImportSource={async () => false}
      onOpenWorkspacePath={async () => {}}
      onOpenDroppedWorkspace={async () => {}} />
  </SurfaceAppearanceProvider>;
}

function Fixture() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (FEEDBACK) await prepareFeedback();
      else if (COACHMARK) await wait(200);
      else if (fixture.intro !== null) {
        // Hold every intro animation at the same instant.
        await wait(0);
        for (const animation of document.getAnimations()) {
          animation.pause();
          animation.currentTime = fixture.intro;
        }
      } else {
        // The intro (≈1.1s), then the disclosure it was holding back.
        await wait(1_600);
      }
      if (!cancelled) window.__referenceReady = true;
    })();
    return () => { cancelled = true; };
  }, []);
  if (COACHMARK) return <Coachmark feature={COACHMARK} />;
  return FEEDBACK ? <DesktopHelpLauncher theme={fixture.mode} subThemeId="default.neutral" /> : <Home />;
}

const catalogs = window.__catalogs;
const initialState = { locale: fixture.locale, preference: "system", direction: "ltr", systemLanguages: ["en-US"] };
const localization = { initialState, initialCatalog: catalogs[fixture.locale], fallbackCatalog: catalogs.en,
  loadCatalog: async (locale: string) => ({ catalog: catalogs[locale], fallbackCatalog: catalogs.en }),
  client: { onLocaleChanged: () => () => {}, setLanguagePreference: async (preference: string) => ({ ...initialState, preference, locale: preference }) } };
createRoot(document.getElementById("root")!).render(
  <LocalizationProvider {...(localization as never)}>
    <TypographyCatalogProvider><Fixture /></TypographyCatalogProvider>
  </LocalizationProvider>,
);
