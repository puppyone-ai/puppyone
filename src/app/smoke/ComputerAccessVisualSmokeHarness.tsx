import { useLocalization } from "@puppyone/localization";
import { useState } from "react";
import { DesktopDialogRoot, DesktopDialogSurface } from "../../components/DesktopDialog";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../features/appearance/AppearanceRuntime";
import { OtherComputersSettings } from "../../features/hosts/ui/OtherComputersSettings";
import { SettingsSidebar } from "../../features/settings/sidebar/SettingsSidebar";
import { useDesktopAppearance, useDesktopPreferenceEffects } from "../../features/settings";
import { TypographyCatalogProvider, useTypographyCatalog, useTypographyRuntime } from "../../features/typography";
import { desktopPreferencesStore, initializeDesktopPreferences, useDesktopPreference } from "../../preferencesStore";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import type { HostCatalogDevice, HostSharingStatus } from "../../../shared/host-contract/types";

/** #computer-access-visual-smoke?state=empty|ready|error|local-error|loading|signed-out. In-memory fixtures only. */
const params = new URLSearchParams(window.location.search);
const state = params.get("state") ?? "empty";
initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
desktopPreferencesStore.setState((previous) => ({ themeMode: params.get("theme") === "light" ? "light" : "dark",
  experimentalSettings: { ...previous.experimentalSettings, enableHostDevices: true } }));
const THIS = "11111111-1111-4111-8111-111111111111";
const session = { user_id: "fixture-user", session_generation: "1", api_base_url: "https://cloud-fixture.puppyone.ai/api/v1" } as DesktopCloudSession;
const ready = state === "ready";
let paused = false;
const folders = [{ id: "notes", name: "Research notes", state: "active" as const, revision: 1, capabilities: ["folder.read" as const] },
  { id: "project", name: "puppyone-website", state: "active" as const, revision: 1, capabilities: ["folder.read" as const, "folder.write" as const] }];
const devices: HostCatalogDevice[] = ready ? [
  { id: THIS, name: "MacBook Pro", platform: "darwin", state: "active", revision: 1, online: true, last_seen_at: null, folders },
  { id: "studio", name: "Studio Mac", platform: "darwin", state: "active", revision: 1, online: true, last_seen_at: null, folders: [] },
  { id: "office", name: "Office PC", platform: "win32", state: "active", revision: 1, online: false,
    last_seen_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), folders: [] },
] : [];
window.puppyoneDesktop = { ...window.puppyoneDesktop,
  listHostDevices: async () => {
    if (state === "loading") return new Promise(() => {});
    if (state === "error") throw new Error("Fixture unavailable");
    return { devices };
  },
  getHostStatus: async (): Promise<HostSharingStatus> => {
    if (state === "loading") return new Promise(() => {});
    if (state === "local-error") throw new Error("Fixture unavailable");
    return { state: ready ? "online" : "off", deviceId: ready ? THIS : null, paused, activeRequests: 0, watching: 0,
      lastAccessAt: null, running: [], folders: ready ? folders.map((folder) => ({ folderId: folder.id, name: folder.name,
        writable: folder.capabilities.includes("folder.write") })) : [] };
  },
  onHostStatus: () => () => {},
  getHostAutostart: async () => ({ supported: true, enabled: true }),
  setHostAutostart: async ({ enabled }: { enabled: boolean }) => ({ supported: true, enabled }),
  setHostSharingPaused: async (value: { paused: boolean }) => { paused = value.paused; return {}; },
  revokeHostDevice: async () => ({ revoked: false }),
} as unknown as NonNullable<typeof window.puppyoneDesktop>;

export function ComputerAccessVisualSmokeHarness() {
  return <TypographyCatalogProvider><Fixture /></TypographyCatalogProvider>;
}
function Fixture() {
  const [section, setSection] = useState<"other-computers" | "account">("other-computers");
  useDesktopPreferenceEffects();
  const { resolvedAppearance, lightThemePreset, darkThemePreset } = useDesktopAppearance();
  const preferences = useDesktopPreference((s) => s.typographyPreferences);
  const { locale, t } = useLocalization();
  const typography = useTypographyRuntime(preferences, useTypographyCatalog(), locale);
  const markdownPresentation = useDesktopPreference((s) => s.markdownPresentation);
  const pointerCursors = useDesktopPreference((s) => s.pointerCursors);
  const diffMarkers = useDesktopPreference((s) => s.diffMarkers);
  const appearance = resolveSurfaceAppearance({ appearance: resolvedAppearance, typography, lightThemePreset, darkThemePreset,
    markdownPresentation, pointerCursors, diffMarkers });
  return <SurfaceAppearanceProvider value={appearance}><div className="app-shell" style={{ height: "100vh" }}>
    <DesktopDialogRoot className="desktop-settings-dialog-backdrop" onClose={() => {}}>
      <DesktopDialogSurface className="desktop-settings-dialog" width={960} ariaLabel={t("shell.navigation.settings")}>
        <header className="desktop-dialog-header desktop-settings-dialog-header"><h2>{t("shell.navigation.settings")}</h2></header>
        <div className="desktop-settings-dialog-layout">
          <aside className="desktop-settings-dialog-navigation"><SettingsSidebar activeSection={section} cloudEnabled
            onSelectSection={(value) => { if (value === "account") setSection(value); }} /></aside>
          <main className="desktop-settings-dialog-content">
            {section === "account" ? <p>{t("settings.account.signInWithBrowser")}</p>
              : <OtherComputersSettings session={state === "signed-out" ? null : session} onSignIn={() => setSection("account")} />}
          </main>
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </div></SurfaceAppearanceProvider>;
}
