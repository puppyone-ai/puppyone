import { useEffect, useState } from "react";
import { EditorView } from "@codemirror/view";
import { useLocalization } from "@puppyone/localization";
import { TypographyCatalogProvider, useTypographyCatalog, useTypographyRuntime } from "../../typography";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../appearance/AppearanceRuntime";
import { useDesktopPreference, useDesktopAppearance, useDesktopPreferenceEffects, initializeDesktopPreferences } from "../../settings";
import { MinimalOnboarding } from "../../../components/MinimalOnboarding";
import { useHomepageCloudProjects } from "./useHomepageCloudProjects";
import { HomepageCloudStatus } from "./HomepageCloudStatus";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { useAccountCloudWorkspace } from "./useAccountCloudWorkspace";
import { useNativeCloudWorkbench } from "./useNativeCloudWorkbench";
import { DesktopHelpLauncher } from "../../app-shell/DesktopHelpLauncher";
import { AccountCloudWorkspaceSurface, useAccountCloudWorkspacePresentation } from "./AccountCloudWorkspaceSurface";

initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const project = (id: string) => ({ id, name: `Hosted ${id}`, org_id: "team", updated_at: id === "beta" ? "2026-06-01T00:00:00Z" : "2026-04-01T00:00:00Z", capabilities: ["content.read", "content.write"] });
const projects = [project("alpha"), project("beta")];
const files = new Map([["alpha", "ALPHA_CLOUD_BODY"], ["beta", "BETA_CLOUD_BODY"]]);
const heads = new Map([["alpha", 1], ["beta", 1]]);
const writes: Array<{ project: string; content: string }> = [];
let sessionNumber = 1;
const makeSession = (): DesktopCloudSession => ({ api_base_url: API, user_id: "fixture-user", user_email: "fixture@example.com",
  session_generation: String(sessionNumber++), expires_in: 3600, expires_at: Date.now() + 3600000, status: "authenticated" });
async function fixtureRequest(request: Parameters<NonNullable<typeof window.puppyoneDesktop>["requestCloudSessionApi"]>[0]) {
    if (request.path.startsWith("/projects/?")) return projects;
    if (request.path === "/organizations/") return [{ id: "team", name: "Fixture team" }];
    if (request.path.endsWith("/repository-context")) {
      const { target } = JSON.parse(request.body!);
      return { project: project(target.project_id), target };
    }
    const url = new URL(request.path, API);
    const id = url.pathname.split("/")[2]!;
    const operation = url.pathname.split("/").at(-1);
    const path = url.searchParams.get("path") ?? "";
    if (url.pathname === `/projects/${id}`) return project(id);
    if (["scopes", "surfaces", "mcp-endpoints", "bindings", "providers"].includes(operation ?? "")) return [];
    if (operation === "access-point") return { project_id: id, url: `https://cloud-fixture.puppyone.ai/git/${id}.git`, scopes: [] };
    if (operation === "commits") return { project_id: id, commits: [], head_commit_id: null, refs: [],
      refs_included: true, snapshot_id: "a".repeat(64), next_cursor: null, has_more: false, total: 0,
      graph_health: "complete", unreadable_commit_ids: [] };
    if (operation === "ls") return { entries: [{ name: "readme.txt", path: "readme.txt", type: "file" }], head_commit_id: `head-${heads.get(id)}` };
    if (operation === "stat") return { exists: true, name: "readme.txt", type: "file", path };
    if (operation === "cat") return { content_text: files.get(id), head_commit_id: `head-${heads.get(id)}` };
    if (operation === "write") {
      const body = JSON.parse(request.body!);
      if (body.base_commit_id !== `head-${heads.get(id)}`) throw new Error("Fixture CAS mismatch");
      files.set(id, body.content); heads.set(id, heads.get(id)! + 1); writes.push({ project: id, content: body.content });
      return { path: body.path, commit_id: `head-${heads.get(id)}` };
    }
    throw new Error(`Unexpected account workspace fixture request: ${request.path}`);
}
window.puppyoneDesktop = { ...window.puppyoneDesktop,
  requestCloudSessionApi: async (request) => ({ transport: "puppyone-cloud-ipc-v1", ok: true, data: await fixtureRequest(request) }),
} as NonNullable<typeof window.puppyoneDesktop>;

declare global { interface Window { __accountCloudSmoke?: {
  state: () => { active: boolean; project: string | null; writes: typeof writes; settingsOpened: number };
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
  const workbench = useNativeCloudWorkbench({ context: account.context, session, apiBaseUrl: API,
    active: account.active, filesVisibilitySettings: filesVisibilitySettings });
  const [settingsOpened, setSettingsOpened] = useState(0);
  const presentation = useAccountCloudWorkspacePresentation({ workbench,
    onOpenSettings: () => setSettingsOpened(count => count + 1),
    sidebarUtility: <DesktopHelpLauncher appearance={appearance} /> });
  useEffect(() => {
    window.__accountCloudSmoke = { state: () => ({ active: account.active, project: account.context.projectId, writes, settingsOpened }),
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
  }, [account, setTheme, settingsOpened]);
  return <SurfaceAppearanceProvider value={appearance}>
    {!account.active && <MinimalOnboarding appearance={appearance} projectItems={homepage.items}
      cloudOpening={account.opening}
      onChooseWorkspace={async () => {}} onOpenWorkspacePath={async () => {}} onOpenDroppedWorkspace={async () => {}}
      onOpenCloudProject={(id) => void account.openTarget({ kind: "project_root", project_id: id })}
      cloudAccountStatus={<HomepageCloudStatus status={homepage.status} restoring={false} empty={homepage.items.length === 0} apiBaseUrl={API}
        controller={account} onRetry={homepage.refresh} />} />}
    <AccountCloudWorkspaceSurface localProjects={[]} onSelectProject={() => {}} onCreateProject={() => {}} workbench={workbench} presentation={presentation} active={account.active}
      context={account.context} session={session} apiBaseUrl={API} onSessionChange={setSession}
      appearance={appearance} onLocal={account.useLocal} onHome={account.useLocal} />
  </SurfaceAppearanceProvider>;
}
