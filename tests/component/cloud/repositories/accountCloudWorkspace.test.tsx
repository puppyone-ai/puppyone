import { workspaceFixtureBridge, fixtureWorkspaceWatch, fileVersion, liveEntry } from "../../../fixtures/cloud/repositories/liveWorkspace";
import { nativeSnapshot, nativeVersion, nativeReceipt } from "../../../fixtures/cloud/repositories/nativeRepository";
/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountCloudWorkspace, type AccountCloudWorkspace } from "../../../../src/features/cloud/workbench/useAccountCloudWorkspace";
import { useNativeCloudWorkbench, type NativeCloudWorkbench } from "../../../../src/features/cloud/workbench/useNativeCloudWorkbench";
import { useHomepageCloudProjects } from "../../../../src/features/cloud/workbench/useHomepageCloudProjects";
import { cloudCache } from "../../../../src/features/cloud/cache/cloudCache";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { ProjectCloudContext } from "../../../../src/features/cloud/project/context/projectCloudContext";
import { cloudMessage } from "../../../../src/features/cloud/cloudPresentation";
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
let workbench: NativeCloudWorkbench;
type Request = Parameters<NonNullable<typeof window.puppyoneDesktop>["requestCloudSessionApi"]>[0];
let bridge: ReturnType<typeof vi.fn<(request: Request) => unknown>>;
let localWrite: ReturnType<typeof vi.fn>;
let generation: string;
// A local folder's association never reaches account navigation: a linked
// folder's Cloud project opens as its own project (puppy-issues ADR-001).
function Harness({ currentSession = session, enabled = true, homeVisible = false }: {
  currentSession?: DesktopCloudSession | null; enabled?: boolean; homeVisible?: boolean; association?: ProjectCloudContext;
}) {
  account = useAccountCloudWorkspace({ enabled, session: currentSession, apiBaseUrl: API });
  homepage = useHomepageCloudProjects({ enabled, visible: homeVisible && !account.active, session: currentSession, apiBaseUrl: API, local: [] });
  workbench = useNativeCloudWorkbench({ context: account.context, session: currentSession, apiBaseUrl: API,
    prepared: account.prepared,
    active: account.active, filesVisibilitySettings: { showHiddenFiles: true, excludePatterns: [] } });
  return <><div data-active={account.active} data-project={account.context.projectId ?? ""} />
    {homeVisible && !account.active && homepage.items.map((item) => <span key={item.id}>{item.label}</span>)}
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
    if (url.pathname.endsWith("/files")) return { entries: [{ name: "readme.txt", path: "readme.txt", type: "file" }], ...nativeSnapshot(generation) };
    if (url.pathname.endsWith("/stat")) return { name: path, path, type: "file", exists: true, ...nativeSnapshot(generation) };
    if (url.pathname.endsWith("/file")) return { path: "readme.txt", type: "file", content_text: "Cloud content", ...nativeSnapshot(generation) };
    if (request.method === "PUT") return { path: JSON.parse(request.body!).path, ...nativeReceipt("head-2", url.pathname.split("/")[2]) };
    if (request.path === "/projects/" && request.method === "POST") return project("created");
    throw new Error(`Unexpected fixture request: ${request.path}`);
  });
  localWrite = vi.fn();
  window.puppyoneDesktop = { requestCloudSessionApi: workspaceFixtureBridge(bridge), ...fixtureWorkspaceWatch(), writeFile: localWrite } as unknown as NonNullable<typeof window.puppyoneDesktop>;
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  // Release models while the provider is still current.
  await closeAllDocumentWorkingCopies("app-close");
  await act(async () => root.unmount()); retireAllDocumentInputs(); document.body.innerHTML = ""; window.localStorage.clear();
});

describe("account-owned Cloud workspaces on the existing API", () => {
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

  it.each([
    [401, undefined, "project-sign-in-required", "account"],
    [402, undefined, "workspace-plan-required", "account"],
    [403, undefined, "workspace-access-denied", "none"],
    [404, undefined, "workspace-service-unavailable", "none"],
    [503, "workbench_provider_not_configured", "workspace-not-configured", "none"],
    [503, undefined, "workspace-open-failed", "retry"],
  ])("preserves the selected project and classifies runtime failure %s / %s", async (status, code, expected, action) => {
    await render(); await open("a");
    const original = window.puppyoneDesktop!.requestCloudSessionApi;
    const requests = vi.fn<typeof original>(async request => request.path === "/projects/b/workbench"
      ? { transport: "puppyone-cloud-ipc-v1", ok: false, error: { status, code, message: "Private provider diagnostics" } }
      : original(request));
    window.puppyoneDesktop!.requestCloudSessionApi = requests;
    await act(async () => {
      await expect(account.openTarget({ kind: "project_root", project_id: "b" }, () => true, true))
        .rejects.toMatchObject({ failure: { message: { code: expected }, action } });
    });
    expect(account.failure).toEqual({ message: { code: expected }, action });
    expect(account.context.projectId).toBe("a");
    expect(account.active).toBe(true);
    expect(requests.mock.calls.map(([request]) => [request.method, request.path])).toEqual([
      ["POST", "/projects/b/repository-context"], ["GET", "/projects/b/workbench"],
    ]);
    expect(localWrite).not.toHaveBeenCalled();
  });

  it("distinguishes a missing project from an unavailable runtime", async () => {
    bridge.mockRejectedValueOnce(Object.assign(new Error("Not found"), { status: 404 }));
    await render(); await open("missing");
    expect(account.failure).toMatchObject({ message: { code: "project-unavailable" }, action: "none" });
    expect(account.active).toBe(false);
    expect(bridge).toHaveBeenCalledOnce();
    expect(bridge.mock.calls[0][0].path).toBe("/projects/missing/repository-context");
  });

  it.each([
    ["retained", "workspace-recovery-required", "none"],
    ["cleanup_pending", "workspace-recovery-required", "none"],
  ])("does not allocate another runtime when its state is %s", async (state, code, action) => {
    const original = window.puppyoneDesktop!.requestCloudSessionApi;
    const requests = vi.fn<typeof original>(async request => request.path.endsWith("/workbench")
      ? { transport: "puppyone-cloud-ipc-v1", ok: true, data: { workspace: { id: "workbench-a", project_id: "a", generation: "one", state } } } : original(request));
    window.puppyoneDesktop!.requestCloudSessionApi = requests;
    await render(); await open("a");
    expect(account.failure).toMatchObject({ message: { code }, action });
    expect(account.active).toBe(false);
    expect(requests.mock.calls.filter(([request]) => request.path.endsWith("/workbench"))).toHaveLength(1);
    expect(requests.mock.calls.at(-1)![0].method).toBe("GET");
  });

  it.each(["local-only", "wrong-host", "not-authorized", "not-found"])("keeps the account catalog usable when local association is %s", async (status) => {
    const context = status === "local-only" ? { status, projectId: null } : { status, projectId: "local-target", message: cloudMessage("remote-wrong-host") };
    await render({ homeVisible: true, association: context as ProjectCloudContext });
    expect(homepage.items).toHaveLength(2);
    expect(account.error).toBeNull();
    expect(bridge.mock.calls.some(([request]) => request.path.includes("repository-context"))).toBe(false);
    await open("b"); expect(account.context.projectId).toBe("b");
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
      if (request.path.startsWith("/projects/b/workbench/")) throw new Error("Offline");
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
    bridge.mockImplementation((request) => request.path.startsWith("/projects/a/workbench/") ? pending.promise : actual(request));
    await render();
    let opening!: Promise<void>;
    await act(async () => { opening = account.openTarget({ kind: "project_root", project_id: "a" }); });
    await act(async () => account.cancel());
    await open("b");
    await act(async () => { pending.resolve({ entries: [], ...nativeSnapshot("old") }); await opening; });
    expect(account.context.projectId).toBe("b");
  });

  it("keeps the displayed Cloud project when the shared navigation supersedes a request", async () => {
    await render(); await open("a");
    await act(async () => account.openTarget({ kind: "project_root", project_id: "b" }, () => false));
    expect(account.context.projectId).toBe("a");
    expect(account.opening).toBe(false);
    expect(account.error).toBeNull();
  });

  it("reports an opening failure to the shared navigation without replacing the current project", async () => {
    await render(); await open("a");
    const actual = bridge.getMockImplementation()!;
    bridge.mockImplementation(request => {
      if (request.path.startsWith("/projects/b/workbench/")) throw new Error("Offline");
      return actual(request);
    });
    await act(async () => {
      await expect(account.openTarget({ kind: "project_root", project_id: "b" }, () => true, true)).rejects.toThrow();
    });
    expect(account.context.projectId).toBe("a");
    expect(account.opening).toBe(false);
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
    const copy = getOrCreateDocumentWorkingCopy({ documentId: node.path, initialContent: "Cloud content", initialVersion: fileVersion("Cloud content", "a"), saveMode: "manual", persistence: port.documentPersistence! });
    await render({ currentSession: null });
    await render({ currentSession: { ...session, session_generation: "two" } }); await open("a");
    const nextPort = workbench.dataPort!;
    const reopened = getDocumentInputRuntime(nextPort, node as Parameters<typeof getDocumentInputRuntime>[1]);
    const stopAgain = reopened.subscribe(() => {});
    await vi.waitFor(() => expect(reopened.getSnapshot().generation).toBeGreaterThan(1)); stopAgain();
    expect(reopened.getSnapshot().error).toBeNull();
    const nextCopy = getOrCreateDocumentWorkingCopy({ documentId: node.path, initialContent: "Cloud content", initialVersion: fileVersion("Cloud content", "a"), saveMode: "manual", persistence: nextPort.documentPersistence! });
    expect(nextCopy).toBe(copy);
    let text = "Cloud content";
    const detach = copy.session.attachSource({ readSnapshot: () => ({ revision: "edit-1", content: text }), replaceContent: (value) => { text = value; return { revision: "edit-2", content: text }; } });
    text = "New edit";
    await copy.session.requestSave(); detach();
    expect(bridge.mock.calls.findLast(([request]) => request.method === "PUT")![0].expectedSession.generation).toBe("two");
  });

  it("does not fetch organizations or create or publish projects from the Homepage", async () => {
    await render({ homeVisible: true });
    expect(bridge.mock.calls.every(([request]) => request.method === "GET"
      && (request.path.startsWith("/projects/?") || request.path.includes("/commits?limit=1")))).toBe(true);
    expect(localWrite).not.toHaveBeenCalled();
  });
});
