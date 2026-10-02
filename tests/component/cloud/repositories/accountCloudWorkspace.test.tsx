/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountCloudWorkspace, type AccountCloudWorkspace } from "../../../../src/features/cloud/workbench/useAccountCloudWorkspace";
import { useNativeCloudWorkbench, type NativeCloudWorkbench } from "../../../../src/features/cloud/workbench/useNativeCloudWorkbench";
import { AccountCloudProjectPicker } from "../../../../src/features/cloud/workbench/AccountCloudProjectPicker";
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
let workbench: NativeCloudWorkbench;
type Request = Parameters<NonNullable<typeof window.puppyoneDesktop>["requestCloudSessionApi"]>[0];
let bridge: ReturnType<typeof vi.fn<(request: Request) => unknown>>;
let localWrite: ReturnType<typeof vi.fn>;
let generation: string;
function Harness({ currentSession = session, enabled = true }: { currentSession?: DesktopCloudSession | null; enabled?: boolean }) {
  account = useAccountCloudWorkspace({ enabled, session: currentSession, apiBaseUrl: API });
  workbench = useNativeCloudWorkbench({ context: account.context, session: currentSession, apiBaseUrl: API,
    active: account.active, filesVisibilitySettings: { showHiddenFiles: true, excludePatterns: [] } });
  return <><div data-active={account.active} data-project={account.context.projectId ?? ""} />
    <AccountCloudProjectPicker controller={account} apiBaseUrl={API} onSignOut={() => {}}
      authState={currentSession ? { status: "signed-in", apiBaseUrl: API, session: currentSession } : { status: "signed-out", apiBaseUrl: API }} /></>;
}
async function render(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(withTestLocalization(<Harness {...props} />)));
}
async function open(id: string) { await act(async () => { await account.openTarget({ kind: "project_root", project_id: id }); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { resolve, promise }; }

beforeEach(() => {
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
  it("opens an authorized hosted project without any local workspace or Git remote", async () => {
    await render(); expect(bridge).not.toHaveBeenCalled();
    await act(async () => account.open());
    expect(document.body.textContent).toContain("Project a");
    await open("a");
    expect(account.active).toBe(true);
    expect(workbench.service?.workspace.name).toBe("Project a");
    expect(workbench.service?.workspace.path).toMatch(/^puppyone-cloud:/);
    expect(account.pickerOpen).toBe(false);
    const [node] = await workbench.dataPort!.listChildren(null);
    expect((await workbench.dataPort!.readFile!(node!.path)).content).toBe("Cloud content");
    expect(bridge.mock.calls.find(([request]) => request.path.startsWith("/projects/?"))![0]).toMatchObject({
      path: "/projects/?include_access_counts=false", expectedSession: { userId: "alice", generation: "one" },
    });
    expect(localWrite).not.toHaveBeenCalled();
  });

  it.each(["local-only", "wrong-host", "not-authorized", "not-found"])("keeps the account catalog usable when local association is %s", async (status) => {
    await render();
    const context = status === "local-only" ? { status, projectId: null } : { status, projectId: "local-target", message: cloudMessage("remote-wrong-host") };
    await act(async () => account.open(context as ProjectCloudContext));
    expect(account.projects).toHaveLength(2);
    expect(account.error).toBeNull();
    expect(bridge.mock.calls.some(([request]) => request.path.includes("repository-context"))).toBe(false);
    await open("b"); expect(account.context.projectId).toBe("b");
  });

  it("keeps a failed linked-project open recoverable through the account catalog", async () => {
    const actual = bridge.getMockImplementation()!;
    bridge.mockImplementation(async (request) => {
      if (request.path.includes("/missing/")) throw Object.assign(new Error("Not found"), { status: 404 });
      return actual(request);
    });
    await render();
    await act(async () => account.open({ status: "resolved", projectId: "missing", target: { kind: "project_root", project_id: "missing" } }));
    expect(account.active).toBe(false); expect(account.pickerOpen).toBe(true);
    expect(account.projects).toHaveLength(2); expect(account.error).toBe("open");
    await open("a"); expect(account.active).toBe(true);
  });

  it("lists projects after sign-in without selecting a project implicitly", async () => {
    await render({ currentSession: null }); await act(async () => account.open());
    expect(bridge).not.toHaveBeenCalled(); expect(account.pickerOpen).toBe(true);
    await render();
    expect(account.projects).toHaveLength(2); expect(account.active).toBe(false);
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
    expect(account.pickerOpen).toBe(true); expect(account.error).toBe("open");
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
    expect(account.active).toBe(false); expect(account.projects).toEqual([]); expect(account.context.projectId).toBeNull();
  });

  it("returns to local without changing Git configuration or losing the selected Cloud identity", async () => {
    await render(); await open("a");
    const id = workbench.service!.workspace.id;
    await act(async () => account.useLocal());
    expect(account.active).toBe(false); expect(workbench.service!.workspace.id).toBe(id);
    await act(async () => account.open({ status: "resolved", projectId: "b", target: { kind: "project_root", project_id: "b" } }));
    expect(account.context.projectId).toBe("a"); expect(account.active).toBe(true);
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

  it("creates through the current org contract, retaining the idempotency key on retry", async () => {
    const actual = bridge.getMockImplementation()!; let count = 0;
    bridge.mockImplementation((request) => {
      if (request.path === "/projects/" && ++count === 1) throw new Error("Lost response");
      return actual(request);
    });
    await render(); await act(async () => account.browse());
    await act(async () => account.create("org", "New project")); expect(account.error).toBe("create");
    await act(async () => account.create("org", "New project"));
    const creates = bridge.mock.calls.filter(([request]) => request.path === "/projects/").map(([request]) => request);
    expect(creates).toHaveLength(2);
    expect(creates[0].headers!["Idempotency-Key"]).toBe(creates[1].headers!["Idempotency-Key"]);
    expect(JSON.parse(creates[0].body!)).toEqual({ org_id: "org", name: "New project" });
    expect(account.context.projectId).toBe("created"); expect(localWrite).not.toHaveBeenCalled();
  });
});
