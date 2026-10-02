import { useEffect, useState } from "react";
import { EditorView } from "@codemirror/view";
import { useLocalization } from "@puppyone/localization";
import { TypographyCatalogProvider, useTypographyCatalog, useTypographyRuntime } from "../../typography";
import { resolveSurfaceAppearance, SurfaceAppearanceProvider } from "../../appearance/AppearanceRuntime";
import { useDesktopPreferences } from "../../app-shell/useDesktopPreferences";
import { DesktopOverlayPortal } from "../../app-shell/DesktopOverlayPortal";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { useAccountCloudWorkspace } from "./useAccountCloudWorkspace";
import { useNativeCloudWorkbench } from "./useNativeCloudWorkbench";
import { AccountCloudWorkspaceSurface } from "./AccountCloudWorkspaceSurface";
import { AccountCloudProjectPicker } from "./AccountCloudProjectPicker";

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const project = (id: string) => ({ id, name: `Hosted ${id}`, org_id: "team", capabilities: ["content.read", "content.write"] });
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
  state: () => { active: boolean; project: string | null; writes: typeof writes };
  edit: (text: string) => void;
  signOut: () => void;
  signIn: () => void;
  browse: () => void;
}; } }

/** Production account controller and hosted shell, with no checkout or real Cloud bytes. */
export function AccountCloudWorkbenchSmokeHarness() {
  return <TypographyCatalogProvider><AccountCloudFixture /></TypographyCatalogProvider>;
}
function AccountCloudFixture() {
  const [session, setSession] = useState<DesktopCloudSession | null>(makeSession);
  const preferences = useDesktopPreferences();
  const { locale, t } = useLocalization();
  const catalog = useTypographyCatalog();
  const typography = useTypographyRuntime(preferences.typographyPreferences, catalog, locale);
  const appearance = resolveSurfaceAppearance({ appearance: preferences.resolvedAppearance, typography,
    markdownPresentation: preferences.markdownPresentation, loadingAnimationPreset: preferences.loadingAnimationPreset,
    lightThemePreset: preferences.lightThemePreset, darkThemePreset: preferences.darkThemePreset,
    pointerCursors: preferences.pointerCursors, diffMarkers: preferences.diffMarkers });
  const account = useAccountCloudWorkspace({ enabled: true, session, apiBaseUrl: API });
  const workbench = useNativeCloudWorkbench({ context: account.context, session, apiBaseUrl: API,
    active: account.active, filesVisibilitySettings: preferences.filesVisibilitySettings });
  useEffect(() => {
    window.__accountCloudSmoke = { state: () => ({ active: account.active, project: account.context.projectId, writes }),
      browse: account.browse, signOut: () => setSession(null), signIn: () => setSession(makeSession()),
      edit: (text) => {
        const editor = document.querySelector(".desktop-account-cloud-workspace .cm-editor");
        const view = editor ? EditorView.findFromDOM(editor as HTMLElement) : null;
        if (!view) throw new Error("No hosted editor");
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      },
    };
    return () => { delete window.__accountCloudSmoke; };
  }, [account]);
  return <SurfaceAppearanceProvider value={appearance}>
    {!account.active && <button data-account-cloud-entry onClick={() => account.open()}>{t("cloud.catalog.browse")}</button>}
    <AccountCloudWorkspaceSurface workbench={workbench} active={account.active} preferences={preferences}
      appearance={appearance} onLocal={account.useLocal} onBrowse={account.browse} />
    <DesktopOverlayPortal appearance={appearance}>
      <AccountCloudProjectPicker controller={account} apiBaseUrl={API} onSignOut={() => setSession(null)}
        authState={session ? { status: "signed-in", session, apiBaseUrl: API } : { status: "signed-out", apiBaseUrl: API }} />
    </DesktopOverlayPortal>
  </SurfaceAppearanceProvider>;
}
