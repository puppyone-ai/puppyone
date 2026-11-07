import { useState } from "react";
import { CloudPublishDialog } from "../../features/cloud/initialization/CloudPublishDialog";
import { CloudGitPrerequisite } from "../../features/cloud/initialization/CloudGitPrerequisite";
import { useLocalization } from "@puppyone/localization";
import type { HostCatalogDevice, HostSharingStatus } from "../../../shared/host-contract/types";
import { MinimalOnboarding } from "../../components/MinimalOnboarding";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../features/appearance/AppearanceRuntime";
import { useProjectEntryFlow } from "../../features/app-shell/ProjectEntryFlow";
import { ProjectPlaceRows } from "../../features/app-shell/project-place/ProjectPlaceMenu";
import { resolveProjectPlaceMenu } from "../../features/app-shell/project-place/projectPlaceMenuState";
import { HomepageComputers, useHomepageFolderSharing, useHostFolderPlace } from "../../features/hosts";
import { DesktopMenuSurface } from "../../components/DesktopMenu";
import { useHostCatalog } from "../../features/hosts/data/useHostCatalog";
import { HostFolderSharingDialog } from "../../features/hosts/ui/HostFolderSharingDialog";
import { initializeDesktopPreferences, useDesktopAppearance, useDesktopPreference, useDesktopPreferenceEffects } from "../../features/settings";
import { TypographyCatalogProvider, useTypographyCatalog, useTypographyRuntime } from "../../features/typography";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import type { ProjectHomeItem } from "../../lib/workspaceHomeModel";
import { resetDesktopPlatformCapabilitiesForTests } from "../../platform/desktopPlatformClient";

/**
 * The Homepage with the owner's other computers, for visual review:
 * `#homepage-computers-visual-smoke`, optionally `?layout=list`, `?dialog=settings`
 * or `?dialog=share`, `?place=shared` or `?place=unshared` (the Header's place menu),
 * `?theme=light`. Nothing here reaches a Cloud.
 */
const params = new URLSearchParams(window.location.search);
initializeDesktopPreferences({
  getItem: (key) => key.includes("homepageProjectLayout") && params.get("layout") === "list" ? "list" : null,
  setItem: () => {}, removeItem: () => {},
});

const THIS = "11111111-1111-4111-8111-111111111111";
const API = "https://cloud-fixture.puppyone.ai/api/v1";
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const folder = (id: string, name: string, write = false, run = false) => ({ id, name, state: "active" as const, revision: 1,
  capabilities: [
    "folder.read" as const,
    ...(write ? ["folder.write" as const] : []),
    ...(run ? ["folder.shell" as const, "folder.agent" as const] : []),
  ] });
const devices: HostCatalogDevice[] = [
  { id: THIS, name: "Guantum’s MacBook Pro", platform: "darwin", state: "active", revision: 1, online: true,
    last_seen_at: hoursAgo(0), folders: [folder("f-ditherit", "ditherit"), folder("f-vault", "puppyone Vault", true, true), folder("f-todo", "To-Do-List")] },
  { id: "22222222-2222-4222-8222-222222222222", name: "Studio Mac", platform: "darwin", state: "active", revision: 1,
    online: true, last_seen_at: hoursAgo(0), folders: [folder("s-1", "design-system", true), folder("s-2", "launch-video"),
      folder("s-3", "photos 2026"), folder("s-4", "puppyone-website", true), folder("s-5", "research notes")] },
  { id: "33333333-3333-4333-8333-333333333333", name: "Office PC", platform: "win32", state: "active", revision: 1,
    online: false, last_seen_at: hoursAgo(3), folders: [folder("o-1", "Contracts"), folder("o-2", "Finance 2026", true)] },
  { id: "44444444-4444-4444-8444-444444444444", name: "home-server", platform: "linux", state: "active", revision: 1,
    online: true, last_seen_at: hoursAgo(0), folders: [] },
];
const status: HostSharingStatus = { state: "online", deviceId: THIS, paused: false, activeRequests: 0, watching: 1,
  lastAccessAt: null, sandbox: "seatbelt", running: [],
  folders: [{ folderId: "f-ditherit", name: "ditherit", writable: false },
    { folderId: "f-vault", name: "puppyone Vault", writable: true }, { folderId: "f-todo", name: "To-Do-List", writable: false }] };

window.puppyoneDesktop = {
  ...window.puppyoneDesktop,
  getPlatformCapabilities: async () => ({
    schemaVersion: 1, platform: "macos", arch: "arm64", primaryModifier: "meta", windowChrome: { mode: "custom" },
    credentialStorage: { available: false, locked: false, strength: "unavailable", backend: null },
    documentConversion: { supportedInputs: [] }, updater: { supported: false, installMode: "manual" },
  }),
  listHostDevices: async () => ({ devices }),
  getHostStatus: async () => status,
  onHostStatus: () => () => {},
  getHostAutostart: async () => ({ supported: true, enabled: true }),
  setHostAutostart: async ({ enabled }: { enabled: boolean }) => ({ supported: true, enabled }),
  // A deterministic in-memory approval result, never a real Host registration.
  registerHostFolder: async ({ rootPath, writable }: { rootPath: string; writable?: boolean }) => {
    const name = rootPath.split("/").pop()!;
    const folderId = `fixture-${name}`;
    devices[0] = { ...devices[0], folders: [...devices[0].folders.filter((item) => item.id !== folderId),
      folder(folderId, name, writable)] };
    return { deviceId: THIS, folderId };
  },
} as unknown as NonNullable<typeof window.puppyoneDesktop>;
resetDesktopPlatformCapabilitiesForTests();

const session = { api_base_url: API, user_id: "fixture-user", user_email: "fixture@example.com", session_generation: "1",
  expires_in: 3600, expires_at: Date.now() + 3_600_000, status: "authenticated" } as DesktopCloudSession;
const local = (name: string, hostFolderId?: string): ProjectHomeItem => ({ id: `local:${name}`, label: name,
  localPath: `/Users/demo/Projects/${name}`, lastModifiedAt: hoursAgo(5), ...(hostFolderId ? { hostFolderId } : {}) });
const items: ProjectHomeItem[] = [
  { id: "cloud:issues", label: "puppy-issues", localPath: "", cloudProjectId: "issues", lastModifiedAt: hoursAgo(1) },
  { id: "cloud:todo", label: "To-Do-List", localPath: "", cloudProjectId: "todo", lastModifiedAt: hoursAgo(2) },
  local("ditherit", "f-ditherit"), local("marketing-pitch"), local("my disk"), local("puppyone Vault", "f-vault"),
  { ...local("To-Do-List", "f-todo"), linkedCloudProject: { id: "todo", name: "To-Do-List" } },
  local("ontology demo"), local("VC pitch"),
];

export function HomepageComputersVisualSmokeHarness() {
  return <TypographyCatalogProvider><HomepageComputersFixture /></TypographyCatalogProvider>;
}

function HomepageComputersFixture() {
  const [target, setTarget] = useState<{ path: string; spaceId: string } | null>(null);
  const [sharingPath, setSharingPath] = useState<string | null>(null);
  const sharing = useHomepageFolderSharing({ enabled: true, session, apiBase: API,
    workspacePath: sharingPath, workspaceName: sharingPath?.split("/").pop() ?? "",
    openProject: async (path) => setSharingPath(path), returnHome: async () => setSharingPath(null) });
  const spaces = [{ id: "personal", name: "Alex", kind: "personal" as const, canCreateProjects: true },
    { id: "team", name: "Design team", kind: "team" as const, canCreateProjects: true },
    { id: "empty", name: "New team", kind: "team" as const, canCreateProjects: true }];
  useDesktopPreferenceEffects();
  const { resolvedAppearance, lightThemePreset, darkThemePreset } = useDesktopAppearance();
  const setTheme = useDesktopPreference((s) => s.setThemeMode);
  const typographyPreferences = useDesktopPreference((s) => s.typographyPreferences);
  const { locale } = useLocalization();
  const typography = useTypographyRuntime(typographyPreferences, useTypographyCatalog(), locale);
  const markdownPresentation = useDesktopPreference((s) => s.markdownPresentation);
  const pointerCursors = useDesktopPreference((s) => s.pointerCursors);
  const diffMarkers = useDesktopPreference((s) => s.diffMarkers);
  const appearance = resolveSurfaceAppearance({ appearance: resolvedAppearance, typography, lightThemePreset, darkThemePreset,
    markdownPresentation, pointerCursors, diffMarkers });
  const projectEntry = useProjectEntryFlow();
  const requestedTheme = params.get("theme");
  if ((requestedTheme === "light" || requestedTheme === "dark") && resolvedAppearance.effectiveColorMode !== requestedTheme) setTheme(requestedTheme);
  return <SurfaceAppearanceProvider value={appearance}>
    <MinimalOnboarding appearance={appearance} projectItems={params.has("spaces")
      ? items.map((item) => item.cloudProjectId ? { ...item, cloudOrganizationId: item.cloudProjectId === "issues" ? "team" : "personal" } : item)
      : items} projectEntryController={projectEntry}
      cloudSpaces={params.has("spaces") ? spaces : []}
      onPublishToSpace={async (path, spaceId) => setTarget({ path, spaceId })}
      onCreateCloudProject={async () => {}}
      onShareLocalFolder={sharing.request}
      onChooseWorkspace={async () => {}} onOpenWorkspacePath={async () => {}} onOpenDroppedWorkspace={async () => {}}
      onOpenCloudProject={() => {}}
      projectGroups={(base) => <HomepageComputers session={session} apiBase={API} base={base} onOpen={() => {}} />} />
    {sharing.dialog}
    {target && <CloudPublishDialog onClose={() => setTarget(null)}><CloudGitPrerequisite
      activeSection="initialize" projectName={target.path.split("/").pop()} publishBusy={false} publishEnabled
      publishError={null} progressStage={null} organizations={spaces} selectedOrganizationId={target.spaceId}
      organizationStatus="ready" organizationError={null} onPublishWorkspace={() => setTarget(null)} />
    </CloudPublishDialog>}
    {params.get("dialog") && <FixtureDialog kind={params.get("dialog") === "share" ? "share" : "settings"} />}
    {params.get("place") && <FixturePlaceMenu shared={params.get("place") === "shared"} />}
  </SurfaceAppearanceProvider>;
}

const noop = () => undefined;
function FixturePlaceMenu({ shared }: { shared: boolean }) {
  const place = useHostFolderPlace({ enabled: true, session, rootPath: "/Users/demo/Projects/puppyone Vault",
    recordedFolderId: shared ? "f-vault" : null, name: "puppyone Vault" });
  const menu = resolveProjectPlaceMenu({ place: "local", unhosted: true, publishPending: false, disconnectable: false,
    notice: null, linkedFolder: null, address: { short: "~/Projects", full: "~/Projects/puppyone Vault" } });
  return <>
    <DesktopMenuSurface className="desktop-project-place-menu" elevation="compact"
      style={{ position: "fixed", top: 52, left: 220, width: 300, padding: "var(--po-menu-padding)", zIndex: 30 }}>
      <ProjectPlaceRows menu={menu} hostRows={place.placeRows} onDismiss={noop} handlers={{ onPutInCloud: noop,
        onOpenCloudProject: noop, onSignIn: noop, onRetryCloudLink: noop, onDisconnectCloudLink: noop, onOpenLocalFolder: noop }} />
    </DesktopMenuSurface>
    {place.dialog}
  </>;
}

function FixtureDialog({ kind }: { kind: "share" | "settings" }) {
  const catalog = useHostCatalog(session);
  return <HostFolderSharingDialog catalog={catalog} onClose={() => {}} target={kind === "share"
    ? { kind: "share", rootPath: "/Users/demo/Projects/ditherit", name: "ditherit" }
    : { kind: "settings", folderId: "f-vault", name: "puppyone Vault", rootPath: "/Users/demo/Projects/puppyone Vault" }} />;
}
