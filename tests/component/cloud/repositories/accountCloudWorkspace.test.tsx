/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountCloudWorkspace, type AccountCloudWorkspace } from "../../../../src/features/cloud/workbench/useAccountCloudWorkspace";
import { useNativeCloudWorkbench, type NativeCloudWorkbench } from "../../../../src/features/cloud/workbench/useNativeCloudWorkbench";
import { useHomepageCloudProjects } from "../../../../src/features/cloud/workbench/useHomepageCloudProjects";
import { useRepositoryCloudWorkspaceSwitch } from "../../../../src/features/cloud/workbench/useRepositoryCloudWorkspaceSwitch";
import { CloudWorkspaceSwitchDialog } from "../../../../src/features/cloud/workbench/CloudWorkspaceSwitchDialog";
import { RepositoryCloudSwitchGate } from "../../../../src/features/cloud/workbench/RepositoryCloudSwitchGate";
import { cloudCache } from "../../../../src/features/cloud/cache/cloudCache";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { getProjectCloudLocationState, type ProjectCloudContext } from "../../../../src/features/cloud/project/context/projectCloudContext";
import { cloudMessage } from "../../../../src/features/cloud/cloudPresentation";
import { useCurrentRepositoryCloudContext } from "../../../../src/features/cloud/project/context/useCurrentRepositoryCloudContext";
import { gitStatus } from "../../../support/source-control/gitFixtures";
import { withTestLocalization } from "../../../support/react/localization";
import { retireAllDocumentInputs, getDocumentInputRuntime } from "../../../../packages/shared-ui/src/editor/resource/DocumentInputRuntime";
import { getOrCreateDocumentWorkingCopy, closeAllDocumentWorkingCopies } from "../../../../packages/shared-ui/src/editor/document-session/documentWorkingCopies";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: API, user_id: "alice", user_email: "alice@example.com",
  session_generation: "one", expires_in: 3600, expires_at: Date.now() + 3600000, status: "authenticated" };
const project = (id: string) => ({ id, name: `Project ${id}`, org_id: "org", capabilities: ["content.read", "content.write"] });
let root: Root;
let account: AccountCloudWorkspace;
let homepage: ReturnType<typeof useHomepageCloudProjects>;
let header: ReturnType<typeof useRepositoryCloudWorkspaceSwitch>;
const associated = (id: string): ProjectCloudContext => ({ status: "resolved", projectId: id, projectName: `Project ${id}`,
  target: { kind: "project_root", project_id: id }, capabilities: ["content.read", "content.write"] });
let workbench: NativeCloudWorkbench;
type Request = Parameters<NonNullable<typeof window.puppyoneDesktop>["requestCloudSessionApi"]>[0];
let bridge: ReturnType<typeof vi.fn<(request: Request) => unknown>>;
let localWrite: ReturnType<typeof vi.fn>;
let generation: string;
const localFolder = { id: "local-a", path: "/fixture/header-local", name: "Local A", status: "recording" as const };
const localGit = gitStatus({ remotes: [{ name: "puppyone", fetchUrl: "https://cloud-fixture.puppyone.ai/git/a.git",
  pushUrl: "https://cloud-fixture.puppyone.ai/git/a.git", branches: [] }] });
const ignoreSessionChange = () => {};
function Harness({ currentSession = session, enabled = true, homeVisible = false, association = { status: "local-only", projectId: null }, scope = "local-folder", resolveAssociation = false }: {
  currentSession?: DesktopCloudSession | null; enabled?: boolean; homeVisible?: boolean; association?: ProjectCloudContext; scope?: string; resolveAssociation?: boolean;
}) {
  account = useAccountCloudWorkspace({ enabled, session: currentSession, apiBaseUrl: API });
  homepage = useHomepageCloudProjects({ enabled, visible: homeVisible && !account.active, session: currentSession, apiBaseUrl: API, local: [] });
  const derivedContext = useCurrentRepositoryCloudContext({ workspace: resolveAssociation ? localFolder : null,
    activeGitStatus: localGit, activeCloudSession: currentSession, cloudEnabled: enabled,
    desktopCloudApiBaseUrl: API, resolutionInputsLoading: false, updateCloudSession: ignoreSessionChange });
  const headerContext = resolveAssociation ? derivedContext : association;
  header = useRepositoryCloudWorkspaceSwitch({ enabled, scope, context: headerContext, session: currentSession,
    apiBaseUrl: API, onPrepared: account.activatePrepared });
  workbench = useNativeCloudWorkbench({ context: account.context, session: currentSession, apiBaseUrl: API,
    active: account.active, filesVisibilitySettings: { showHiddenFiles: true, excludePatterns: [] } });
  return <><div data-active={account.active} data-project={account.context.projectId ?? ""} />
    {homeVisible && !account.active && homepage.items.map((item) => <span key={item.id}>{item.label}</span>)}
    <CloudWorkspaceSwitchDialog controller={header} authenticationRequired={!currentSession}
      gate={<RepositoryCloudSwitchGate context={headerContext} apiBaseUrl={API} onRetry={header.retry}
        authState={currentSession ? { status: "signed-in", apiBaseUrl: API, session: currentSession } : { status: "signed-out", apiBaseUrl: API }} />} />
  </>;
}
async function render(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(withTestLocalization(<Harness {...props} />)));
}
async function open(id: string) { await act(async () => { await account.openTarget({ kind: "project_root", project_id: id }); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { resolve, promise }; }

beforeEach(() => {
  cloudCache.clear();
  generation = "head-1";
  bridge = vi.fn(async (request) => {
    if (request.path.startsWith("/projects/?")) return [project("a"), project("b")];
    if (request.path === "/organizations/") return [{ id: "org", name: "My team" }];
    if (request.path.endsWith("/repository-context")) {
      const { target } = JSON.parse(request.body!);
      return { project: project(target.project_id), target };
    }
    const url = new URL(request.path, API);
    const path = url.searchParams.get("path") ?? "";
    if (url.pathname.endsWith("/ls")) return { entries: [{ name: "readme.txt", path: "readme.txt", type: "file" }], head_commit_id: generation };
    if (url.pathname.endsWith("/stat")) return { name: path, path, type: "file", exists: true };
    if (url.pathname.endsWith("/cat")) return { content_text: "Cloud content", head_commit_id: generation };
    if (url.pathname.endsWith("/write")) return { path: JSON.parse(request.body!).path, commit_id: "head-2" };
    if (request.path === "/projects/" && request.method === "POST") return project("created");
    throw new Error(`Unexpected fixture request: ${request.path}`);
  });
  localWrite = vi.fn();
  window.puppyoneDesktop = { requestCloudSessionApi: bridge, writeFile: localWrite } as unknown as NonNullable<typeof window.puppyoneDesktop>;
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  // Release models while the provider is still current.
  await closeAllDocumentWorkingCopies("app-close");
  await act(async () => root.unmount()); retireAllDocumentInputs(); document.body.innerHTML = ""; window.localStorage.clear();
});

describe("account-owned Cloud workspaces on the existing API", () => {
  it("does not confuse login state with repository Cloud availability", () => {
    expect(getProjectCloudLocationState({ status: "local-only", projectId: null }, true)).toBe("unavailable");
    expect(getProjectCloudLocationState({ status: "wrong-account", projectId: "a", message: cloudMessage("remote-sign-in") }, false)).toBe("signed-out");
    expect(getProjectCloudLocationState(associated("a"), true)).toBe("available");
  });
  it("opens an authorized hosted project without any local workspace or Git remote", async () => {
    await render({ homeVisible: true });
    expect(document.body.textContent).toContain("Project a");
    await open("a");
    expect(account.active).toBe(true);
    expect(workbench.service?.workspace.name).toBe("Project a");
    expect(workbench.service?.workspace.path).toMatch(/^puppyone-cloud:/);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const [node] = await workbench.dataPort!.listChildren(null);
    expect((await workbench.dataPort!.readFile!(node!.path)).content).toBe("Cloud content");
    expect(bridge.mock.calls.find(([request]) => request.path.startsWith("/projects/?"))![0]).toMatchObject({
      path: "/projects/?include_access_counts=false", expectedSession: { userId: "alice", generation: "one" },
    });
    expect(localWrite).not.toHaveBeenCalled();
  });

  it.each(["local-only", "wrong-host", "not-authorized", "not-found"])("keeps the account catalog usable when local association is %s", async (status) => {
    const context = status === "local-only" ? { status, projectId: null } : { status, projectId: "local-target", message: cloudMessage("remote-wrong-host") };
    await render({ homeVisible: true, association: context as ProjectCloudContext });
    expect(homepage.items).toHaveLength(2);
    expect(account.error).toBeNull();
    expect(bridge.mock.calls.some(([request]) => request.path.includes("repository-context"))).toBe(false);
    await open("b"); expect(account.context.projectId).toBe("b");
  });

  it("keeps Header failure scoped, and automatically lists projects only on the Homepage", async () => {
    const actual = bridge.getMockImplementation()!;
    bridge.mockImplementation(async (request) => {
      if (request.path.includes("/missing/")) throw Object.assign(new Error("Not found"), { status: 404 });
      return actual(request);
    });
    await render({ association: associated("missing") });
    await act(async () => header.request());
    expect(account.active).toBe(false);
    expect(header.pending).toBe(true); expect(header.error?.code).toBe("remote-not-found");
    expect(homepage.items).toHaveLength(0);
    expect(bridge.mock.calls.some(([request]) => request.path.startsWith("/projects/?"))).toBe(false);
    await act(async () => header.cancel());
    await render({ homeVisible: true });
    expect(homepage.items).toHaveLength(2);
    await open("a"); expect(account.active).toBe(true);
  });

  it("lists projects after sign-in without selecting a project implicitly", async () => {
    await render({ currentSession: null, homeVisible: true });
    expect(bridge).not.toHaveBeenCalled();
    await render({ homeVisible: true });
    expect(homepage.items).toHaveLength(2); expect(account.active).toBe(false);
  });

  it("preserves the current Cloud project when opening another project fails", async () => {
    await render(); await open("a");
    const actual = bridge.getMockImplementation()!;
    bridge.mockImplementation(async (request) => {
      if (request.path.startsWith("/content/b/")) throw new Error("Offline");
      return actual(request);
    });
    await open("b");
    expect(account.context.projectId).toBe("a"); expect(account.active).toBe(true);
    expect(account.error).toBe("open");
    bridge.mockImplementation(actual);
    await act(async () => account.retry());
    expect(account.context.projectId).toBe("b");
  });

  it("does not commit a cancelled or superseded project selection", async () => {
    const pending = deferred<unknown>(); const actual = bridge.getMockImplementation()!;
    bridge.mockImplementation((request) => request.path.startsWith("/content/a/") ? pending.promise : actual(request));
    await render();
    let opening!: Promise<void>;
    await act(async () => { opening = account.openTarget({ kind: "project_root", project_id: "a" }); });
    await act(async () => account.cancel());
    await open("b");
    await act(async () => { pending.resolve({ entries: [], head_commit_id: "old" }); await opening; });
    expect(account.context.projectId).toBe("b");
  });

  it("rejects a mismatched project/target response", async () => {
    const actual = bridge.getMockImplementation()!;
    bridge.mockImplementation((request) => request.path.endsWith("/repository-context")
      ? { project: project("b"), target: { kind: "project_root", project_id: "b" } } : actual(request));
    await render(); await open("a");
    expect(account.active).toBe(false); expect(account.error).toBe("open");
    expect(bridge.mock.calls.some(([request]) => request.path.startsWith("/content/"))).toBe(false);
  });

  it("invalidates old-account catalog and late selection results", async () => {
    const pending = deferred<unknown>(); const actual = bridge.getMockImplementation()!;
    bridge.mockImplementation((request) => request.path.endsWith("/repository-context") ? pending.promise : actual(request));
    await render(); let opening!: Promise<void>;
    await act(async () => { opening = account.openTarget({ kind: "project_root", project_id: "a" }); });
    await render({ currentSession: null });
    await act(async () => { pending.resolve({ project: project("a"), target: { kind: "project_root", project_id: "a" } }); await opening; });
    expect(account.active).toBe(false); expect(homepage.items).toEqual([]); expect(account.context.projectId).toBeNull();
  });

  it("returns to local without changing Git configuration or losing the selected Cloud identity", async () => {
    await render(); await open("a");
    const id = workbench.service!.workspace.id;
    await act(async () => account.useLocal());
    expect(account.active).toBe(false); expect(workbench.service!.workspace.id).toBe(id);
    await render({ homeVisible: true });
    expect(account.context.projectId).toBe("a"); expect(account.active).toBe(false);
    expect(homepage.items).toHaveLength(2);
    await open("b"); expect(account.context.projectId).toBe("b");
    expect(bridge.mock.calls.every(([request]) => request.method === "GET" || request.path.endsWith("/repository-context"))).toBe(true);
    expect(localWrite).not.toHaveBeenCalled();
  });

  it("rebinds retained document inputs and save ports after signing back into the same account", async () => {
    await render(); await open("a");
    const port = workbench.dataPort!;
    const node = (await port.resolveNode!("readme.txt"))!;
    const runtime = getDocumentInputRuntime(port, node as Parameters<typeof getDocumentInputRuntime>[1]);
    const stop = runtime.subscribe(() => {});
    await vi.waitFor(() => expect(runtime.getSnapshot().content?.content).toBe("Cloud content")); stop();
    const copy = getOrCreateDocumentWorkingCopy({ documentId: node.path, initialContent: "Cloud content", initialVersion: "head-1", saveMode: "manual", persistence: port.documentPersistence! });
    await render({ currentSession: null });
    await render({ currentSession: { ...session, session_generation: "two" } }); await open("a");
    const nextPort = workbench.dataPort!;
    const reopened = getDocumentInputRuntime(nextPort, node as Parameters<typeof getDocumentInputRuntime>[1]);
    const stopAgain = reopened.subscribe(() => {});
    await vi.waitFor(() => expect(reopened.getSnapshot().generation).toBeGreaterThan(1)); stopAgain();
    expect(reopened.getSnapshot().error).toBeNull();
    const nextCopy = getOrCreateDocumentWorkingCopy({ documentId: node.path, initialContent: "Cloud content", initialVersion: "head-1", saveMode: "manual", persistence: nextPort.documentPersistence! });
    expect(nextCopy).toBe(copy);
    let text = "Cloud content";
    const detach = copy.session.attachSource({ readSnapshot: () => ({ revision: "edit-1", content: text }), replaceContent: (value) => { text = value; return { revision: "edit-2", content: text }; } });
    text = "New edit";
    await copy.session.requestSave(); detach();
    expect(bridge.mock.calls.findLast(([request]) => request.path.endsWith("/write"))![0].expectedSession.generation).toBe("two");
  });

  it("Header opens the associated ID, never a previously selected unrelated project", async () => {
    await render({ association: associated("a") });
    await open("b"); await act(async () => account.useLocal()); bridge.mockClear();
    await act(async () => header.request());
    expect(account.active).toBe(true); expect(account.context.projectId).toBe("a");
    expect(header.pending).toBe(false);
    expect(document.querySelector(".desktop-cloud-account-picker")).toBeNull();
    expect(bridge.mock.calls.every(([request]) => request.path.startsWith("/content/a/"))).toBe(true);
  });

  it("Header retains its exact repository intent across login and asynchronous association resolution", async () => {
    await render({ currentSession: null, association: { status: "wrong-account", projectId: "a", message: cloudMessage("remote-sign-in") } });
    await act(async () => header.request());
    expect(document.querySelector("[data-cloud-sign-in-action]")).toBeTruthy();
    expect(bridge).not.toHaveBeenCalled();
    await render({ association: { status: "resolving", projectId: null } });
    expect(header.pending).toBe(true); expect(account.active).toBe(false); expect(bridge).not.toHaveBeenCalled();
    await render({ association: associated("a") });
    expect(account.context.projectId).toBe("a"); expect(account.active).toBe(true);
    expect(header.pending).toBe(false);
    expect(bridge.mock.calls.every(([request]) => request.path.startsWith("/content/a/"))).toBe(true);
  });

  it("resolves the canonical remote after login through the real context loader before Header commit", async () => {
    const authorization = deferred<unknown>(); const actual = bridge.getMockImplementation()!;
    bridge.mockImplementation((request) => request.path.endsWith("/repository-context") ? authorization.promise : actual(request));
    await render({ currentSession: null, resolveAssociation: true });
    await act(async () => header.request()); expect(bridge).not.toHaveBeenCalled();
    await render({ resolveAssociation: true });
    expect(header.pending).toBe(true); expect(account.active).toBe(false);
    expect(bridge.mock.calls[0][0].path).toBe("/projects/a/repository-context");
    expect(JSON.parse(bridge.mock.calls[0][0].body!).target).toEqual({ kind: "project_root", project_id: "a" });
    await act(async () => authorization.resolve({ project: project("a"), target: { kind: "project_root", project_id: "a" } }));
    expect(account.context.projectId).toBe("a"); expect(account.active).toBe(true);
    expect(header.pending).toBe(false);
    expect(bridge.mock.calls.some(([request]) => request.path.startsWith("/projects/?") || request.path === "/organizations/")).toBe(false);
  });

  it.each(["local-only", "wrong-host", "not-authorized", "not-found"])("Header never falls back to a catalog when association is %s", async (status) => {
    const association = status === "local-only" ? { status, projectId: null }
      : { status, projectId: "a", message: cloudMessage("remote-unresolvable") };
    await render({ association: association as ProjectCloudContext });
    await act(async () => header.request());
    expect(header.pending).toBe(true);
    expect(document.querySelector("[role=alert]")).toBeTruthy();
    expect(document.querySelector(".desktop-cloud-account-projects")).toBeNull();
    expect(bridge).not.toHaveBeenCalled();
  });

  it("closing Header sign-in cancels late authenticated navigation", async () => {
    await render({ currentSession: null }); await act(async () => header.request());
    await act(async () => header.cancel()); await render({ association: associated("a") });
    expect(header.pending).toBe(false); expect(account.active).toBe(false);
    expect(bridge).not.toHaveBeenCalled();
  });

  it("changing the local repository cancels a pending Header file preflight", async () => {
    const pending = deferred<unknown>(); const actual = bridge.getMockImplementation()!;
    bridge.mockImplementation((request) => request.path.startsWith("/content/a/") ? pending.promise : actual(request));
    await render({ association: associated("a"), scope: "local-a" });
    await act(async () => header.request());
    await render({ association: associated("b"), scope: "local-b" });
    await act(async () => pending.resolve({ entries: [], head_commit_id: "late" }));
    expect(account.active).toBe(false); expect(header.pending).toBe(false);
    expect(bridge.mock.calls.some(([request]) => request.path.startsWith("/content/b/"))).toBe(false);
  });

  it("Header preserves an exact Scope instead of broadening to the Project root", async () => {
    const association: ProjectCloudContext = { status: "resolved", projectId: "a", target: { kind: "scope", project_id: "a", scope_id: "scope-a" },
      scopePath: "docs", capabilities: ["content.read"] };
    // Return only entries inside the authorized view.
    bridge.mockResolvedValue({ entries: [], head_commit_id: "head-1" });
    await render({ association }); await act(async () => header.request());
    expect(account.context).toMatchObject({ target: association.target, scopePath: "docs" });
    expect(workbench.service?.writable).toBe(false);
    expect(new URL(bridge.mock.calls[0][0].path, API).searchParams.get("path")).toBe("docs");
  });

  it("does not fetch organizations or create or publish projects from the Homepage", async () => {
    await render({ homeVisible: true });
    expect(bridge.mock.calls.every(([request]) => request.method === "GET"
      && (request.path.startsWith("/projects/?") || request.path.includes("/commits?limit=1")))).toBe(true);
    expect(localWrite).not.toHaveBeenCalled();
  });
});
