import { cloudHistorySmokeFixture } from "../../features/cloud/workbench/cloudRepositorySmokeFixture";
import { useEffect, useState } from "react";
import { EditorView } from "@codemirror/view";
import { useLocalization } from "@puppyone/localization";
import { TypographyCatalogProvider, useTypographyCatalog, useTypographyRuntime } from "../../features/typography";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../features/appearance/AppearanceRuntime";
import { useDesktopPreference, useDesktopAppearance, useDesktopPreferenceEffects, initializeDesktopPreferences, desktopPreferencesStore } from "../../features/settings";
import { AssetLibraryHome } from "../../components/AssetLibraryHome";
import { MinimalOnboarding } from "../../components/MinimalOnboarding";
import { useHomepageCloudProjects } from "../../features/cloud/workbench/useHomepageCloudProjects";
import { HomepageCloudStatus } from "../../features/cloud/workbench/HomepageCloudStatus";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import { useAccountCloudWorkspace } from "../../features/cloud/workbench/useAccountCloudWorkspace";
import { useNativeCloudWorkbench } from "../../features/cloud/workbench/useNativeCloudWorkbench";
import { DesktopHelpLauncher } from "../../features/app-shell/DesktopHelpLauncher";
import { AccountCloudWorkspaceSurface, useAccountCloudWorkspacePresentation } from "../AccountCloudWorkspaceSurface";
import { createCloudAgentSmokeFixture, editCloudAgentPrompt } from "../../features/cloud/agent/CloudAgentSmokeFixture";

initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
// The geometry acceptance below exercises the optional centered Header layout.
desktopPreferencesStore.setState(s => ({ experimentalSettings: { ...s.experimentalSettings, enableCenteredProjectInHeader: true } }));

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const project = (id: string) => ({ id, name: `Hosted ${id}`, org_id: "team", updated_at: id === "beta" ? "2026-06-01T00:00:00Z" : "2026-04-01T00:00:00Z", capabilities: ["content.read", "content.write"] });
const projects = [project("alpha"), project("beta")];
const files = new Map([["alpha", "ALPHA_CLOUD_BODY"], ["beta", "BETA_CLOUD_BODY"]]);
const heads = new Map([["alpha", 1], ["beta", 1]]);
const agentFixture = createCloudAgentSmokeFixture(id => {
  heads.set(id, heads.get(id)! + 1); files.set(id, `AGENT_PUBLISHED_CLOUD_BODY_${heads.get(id)}`);
});
let writeBarrier: Promise<void> | null = null;
let releaseWriteBarrier = () => {};
const writes: Array<{ project: string; content: string }> = [];
let sessionNumber = 1;
const makeSession = (): DesktopCloudSession => ({ api_base_url: API, user_id: "fixture-user", user_email: "fixture@example.com",
  session_generation: String(sessionNumber++), expires_in: 3600, expires_at: Date.now() + 3600000, status: "authenticated" });
async function workspaceFile(project: string) {
  const bytes = new TextEncoder().encode(files.get(project)!);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return { name: "readme.txt", kind: "file", size: bytes.length, modified_ns: "1",
    content_base64: btoa(String.fromCharCode(...bytes)),
    revision: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("") };
}
async function fixtureRequest(request: Parameters<NonNullable<typeof window.puppyoneDesktop>["requestCloudSessionApi"]>[0]) {
    const agentResult = await agentFixture.request(request);
    if (agentResult !== undefined) return agentResult;
    if (request.path.startsWith("/projects/?")) return projects;
    if (request.path === "/organizations/") return [{ id: "team", name: "Fixture team" }];
    if (request.path.endsWith("/repository-context")) {
      const { target } = JSON.parse(request.body!);
      return { project: project(target.project_id), target };
    }
    const url = new URL(request.path, API);
    const id = url.pathname.split("/")[2]!;
    const operation = url.pathname.split("/").at(-1);
    if (url.pathname === `/projects/${id}`) return project(id);
    if (["scopes", "surfaces", "mcp-endpoints", "bindings", "providers"].includes(operation ?? "")) return [];
    if (operation === "access-point") return { project_id: id, url: `https://cloud-fixture.puppyone.ai/git/${id}.git`, scopes: [] };
    if (operation === "commits") return cloudHistorySmokeFixture(id);
    if (operation === "files") return { entries: [await workspaceFile(id)] };
    if (operation === "file" && request.method === "PUT") {
      await writeBarrier;
      const body = JSON.parse(request.body!);
      if (body.expected_revision !== (await workspaceFile(id)).revision) throw Object.assign(new Error("Fixture CAS mismatch"), { status: 409 });
      const content = new TextDecoder().decode(Uint8Array.from(atob(body.content_base64), character => character.charCodeAt(0)));
      files.set(id, content); heads.set(id, heads.get(id)! + 1); writes.push({ project: id, content });
      return workspaceFile(id);
    }
    if (operation === "file") return workspaceFile(id);
    throw new Error(`Unexpected account workspace fixture request: ${request.path}`);
}
window.puppyoneDesktop = { ...window.puppyoneDesktop,
  watchCloudWorkspace: async ({ id }) => ({ id }), stopCloudWorkspaceWatch: async () => {},
  onCloudWorkspaceEvent: () => () => {},
  requestCloudSessionApi: async (request) => ({ transport: "puppyone-cloud-ipc-v1", ok: true, data: await fixtureRequest(request) }),
} as NonNullable<typeof window.puppyoneDesktop>;

declare global { interface Window { __accountCloudSmoke?: {
  state: () => { active: boolean; project: string | null; writes: typeof writes; settingsOpened: number; selectedLocalPath: string | null; agent: ReturnType<typeof agentFixture.state> };
  editAgent: typeof editCloudAgentPrompt;
  holdWrites: () => void;
  releaseWrites: () => void;
  edit: (text: string) => void;
  signOut: () => void;
  signIn: () => void;
  home: () => void;
  showLocalFixtures: () => void;
  setTheme: (theme: "light" | "dark") => void;
}; } }

/** Production account controller and hosted shell, with no checkout or real Cloud bytes. */
export function AccountCloudWorkbenchSmokeHarness() {
  return <TypographyCatalogProvider><AccountCloudFixture /></TypographyCatalogProvider>;
}
function AccountCloudFixture() {
  const [session, setSession] = useState<DesktopCloudSession | null>(makeSession);
  useDesktopPreferenceEffects();
  const { darkThemePreset } = useDesktopAppearance();
  const diffMarkers = useDesktopPreference(s => s.diffMarkers);
  const filesVisibilitySettings = useDesktopPreference(s => s.filesVisibilitySettings);
  const { lightThemePreset } = useDesktopAppearance();
  const loadingAnimationPreset = useDesktopPreference(s => s.loadingAnimationPreset);
  const markdownPresentation = useDesktopPreference(s => s.markdownPresentation);
  const pointerCursors = useDesktopPreference(s => s.pointerCursors);
  const { resolvedAppearance } = useDesktopAppearance();
  const setTheme = useDesktopPreference(s => s.setThemeMode);
  const typographyPreferences = useDesktopPreference(s => s.typographyPreferences);
  const { locale } = useLocalization();
  const [includeLocal, setIncludeLocal] = useState(false);
  const catalog = useTypographyCatalog();
  const typography = useTypographyRuntime(typographyPreferences, catalog, locale);
  const appearance = resolveSurfaceAppearance({ appearance: resolvedAppearance, typography,
    markdownPresentation: markdownPresentation, loadingAnimationPreset: loadingAnimationPreset,
    lightThemePreset: lightThemePreset, darkThemePreset: darkThemePreset,
    pointerCursors: pointerCursors, diffMarkers: diffMarkers });
  const account = useAccountCloudWorkspace({ enabled: true, session, apiBaseUrl: API });
  const homepage = useHomepageCloudProjects({ enabled: true, visible: !account.active, session, apiBaseUrl: API,
    local: includeLocal ? [
      { workspace: { id: "local-alpha", name: "Hosted alpha", path: "/fixture/alpha", status: "recording", hydrationState: "ready", lastModifiedAt: "2026-04-01T00:00:00Z",
        puppyoneGitRemote: { origin: "https://cloud-fixture.puppyone.ai", projectId: "alpha" } } },
      { workspace: { id: "local-notes", name: "Local notes", path: "/fixture/notes", status: "recording", lastModifiedAt: "2026-05-01T00:00:00Z" } },
      ...Array.from({ length: 4 }, (_, i) => ({ workspace: { id: `local-${i}`, name: `Local sample ${i}`, path: `/fixture/sample-${i}`, status: "recording" as const } })),
    ] : [] });
  const workbench = useNativeCloudWorkbench({ context: account.context, prepared: account.prepared, session, apiBaseUrl: API,
    active: account.active, filesVisibilitySettings: filesVisibilitySettings });
  const [settingsOpened, setSettingsOpened] = useState(0);
  const [selectedLocalPath, setSelectedLocalPath] = useState<string | null>(null);
  const presentation = useAccountCloudWorkspacePresentation({ workbench,
    onOpenSettings: () => setSettingsOpened(count => count + 1),
    sidebarUtility: <DesktopHelpLauncher appearance={appearance} /> });
  useEffect(() => {
    window.__accountCloudSmoke = { state: () => ({ active: account.active, project: account.context.projectId, writes, settingsOpened, selectedLocalPath, agent: agentFixture.state() }),
      editAgent: editCloudAgentPrompt,
      holdWrites: () => { writeBarrier = new Promise(resolve => { releaseWriteBarrier = resolve; }); },
      releaseWrites: () => { writeBarrier = null; releaseWriteBarrier(); },
      home: account.useLocal, showLocalFixtures: () => setIncludeLocal(true), setTheme,
      signOut: () => setSession(null), signIn: () => setSession(makeSession()),
      edit: (text) => {
        const editor = document.querySelector(".desktop-account-cloud-workspace .cm-editor");
        const view = editor ? EditorView.findFromDOM(editor as HTMLElement) : null;
        if (!view) throw new Error("No hosted editor");
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      },
    };
    return () => { delete window.__accountCloudSmoke; };
  }, [account, setTheme, settingsOpened, selectedLocalPath]);
  const Home = new URLSearchParams(location.search).get("home") === "cards" ? AssetLibraryHome : MinimalOnboarding;
  return <SurfaceAppearanceProvider value={appearance}>
    {!account.active && <Home appearance={appearance} projectItems={homepage.items}
      cloudOpening={account.opening}
      onCancelCloudOpening={account.cancel}
      onChooseWorkspace={async () => {}} onOpenWorkspacePath={async () => {}} onOpenDroppedWorkspace={async () => {}}
      onOpenCloudProject={(id) => void account.openTarget({ kind: "project_root", project_id: id })}
      cloudAccountStatus={<HomepageCloudStatus status={homepage.status} restoring={false} empty={homepage.items.length === 0} apiBaseUrl={API}
        session={session} onOpenAccount={() => setSettingsOpened(count => count + 1)}
        controller={account} onRetry={homepage.refresh} />} />}
    <AccountCloudWorkspaceSurface projectItems={homepage.items} onSelectProject={path => { setSelectedLocalPath(path); account.useLocal(); }}
      onSelectCloudProject={(id) => void account.openTarget({ kind: "project_root", project_id: id })}
      onCreateProject={() => {}} workbench={workbench} presentation={presentation} active={account.active}
      context={account.context} session={session} apiBaseUrl={API} onSessionChange={setSession}
      appearance={appearance} onLocal={account.useLocal} onHome={account.useLocal} />
  </SurfaceAppearanceProvider>;
}
