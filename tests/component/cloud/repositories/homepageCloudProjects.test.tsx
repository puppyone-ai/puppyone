/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinimalOnboarding } from "../../../../src/components/MinimalOnboarding";
import { AssetLibraryHome } from "../../../../src/components/AssetLibraryHome";
import { useAccountCloudWorkspace, type AccountCloudWorkspace } from "../../../../src/features/cloud/workbench/useAccountCloudWorkspace";
import { useHomepageCloudProjects } from "../../../../src/features/cloud/workbench/useHomepageCloudProjects";
import { HomepageCloudStatus } from "../../../../src/features/cloud/workbench/HomepageCloudStatus";
import { buildHomepageProjects } from "../../../../src/features/cloud/workbench/homepageCloudProjects";
import { cloudHistoryTargetKey, readCloudProjectHistory, rememberCloudProjectOpen } from "../../../../src/features/cloud/workbench/homepageCloudHistory";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { RecentWorkspaceHomeItem } from "../../../../src/features/app-shell/workspaceHomeModel";
import { withTestLocalization } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: API, user_id: "alice", user_email: "alice@example.com",
  session_generation: "one", expires_in: 3600, expires_at: Date.now() + 3600000, status: "authenticated" };
const project = (id: string) => ({ id, name: `Project ${id}`, capabilities: ["content.read"] });
const local: RecentWorkspaceHomeItem = { workspace: { id: "local", name: "Project a", path: "/fixture/local", status: "recording",
  hydrationState: "ready", puppyoneGitRemote: { origin: "https://cloud-fixture.puppyone.ai", projectId: "a" } }, lastOpenedAt: "2026-01-01T00:00:00Z" };
let root: Root;
let account: AccountCloudWorkspace;
let home: ReturnType<typeof useHomepageCloudProjects>;
let openLocal: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
type Request = Parameters<NonNullable<typeof window.puppyoneDesktop>["requestCloudSessionApi"]>[0];
let bridge: ReturnType<typeof vi.fn<(request: Request) => unknown>>;
const appearance = createTestSurfaceAppearance();
function Harness({ currentSession = session, visible = true, enabled = true, library = false, localItems = [local] }: {
  currentSession?: DesktopCloudSession | null; visible?: boolean; enabled?: boolean; library?: boolean; localItems?: RecentWorkspaceHomeItem[];
}) {
  account = useAccountCloudWorkspace({ enabled, session: currentSession, apiBaseUrl: API });
  home = useHomepageCloudProjects({ enabled, visible: visible && !account.active, session: currentSession, apiBaseUrl: API, local: localItems });
  const Home = library ? AssetLibraryHome : MinimalOnboarding;
  return visible && !account.active ? <Home appearance={appearance} projectItems={home.items}
    groupedProjects={enabled && Boolean(currentSession)} onChooseWorkspace={async () => {}}
    onOpenDroppedWorkspace={async () => {}} onOpenWorkspacePath={openLocal}
    cloudOpening={account.opening} onOpenCloudProject={(id) => void account.openTarget({ kind: "project_root", project_id: id })}
    cloudStatus={enabled ? <HomepageCloudStatus status={home.status} restoring={false} empty={home.items.length === 0} apiBaseUrl={API}
      controller={account} onRetry={home.refresh} /> : undefined} /> : null;
}
async function render(props: Parameters<typeof Harness>[0] = {}) { await act(async () => root.render(withTestLocalization(<Harness {...props} />))); }
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
async function click(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector); expect(button).toBeTruthy();
  await act(async () => button!.click());
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { resolve, promise }; }
beforeEach(() => {
  bridge = vi.fn(async (request) => {
    if (request.path.startsWith("/projects/?")) return [project("a"), project("b")];
    if (request.path.endsWith("/repository-context")) {
      const { target } = JSON.parse(request.body!); return { project: project(target.project_id), target };
    }
    if (request.path.startsWith("/content/")) return { entries: [], head_commit_id: "head" };
    throw new Error(`Unexpected ${request.path}`);
  });
  openLocal = vi.fn(async () => {});
  window.puppyoneDesktop = { requestCloudSessionApi: bridge } as unknown as NonNullable<typeof window.puppyoneDesktop>;
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; localStorage.clear(); vi.unstubAllEnvs(); });

describe("inline Homepage Cloud projects", () => {
  it("automatically loads after login, merges by trusted ID, and has no browse button, picker or create form", async () => {
    await render({ currentSession: null });
    expect(bridge).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(1);
    expect(document.body.textContent).toContain("Sign in to PuppyOne Cloud");
    await render();
    expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(2);
    expect([...document.querySelectorAll(".onboarding-project-group")].map((el) => el.textContent)).toEqual(["Local + Cloud", "Cloud"]);
    expect(document.querySelectorAll('[data-cloud-project-id="a"]')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Browse Cloud projects");
    expect(document.querySelector("form")).toBeNull();
    expect(bridge.mock.calls.map(([request]) => request.path)).toEqual(["/projects/?include_access_counts=false"]);
  });

  it("opens a merged row locally by default, while its explicit Cloud action authorizes the exact ID", async () => {
    await render(); bridge.mockClear();
    await click('[data-cloud-project-id="a"] .onboarding-project-row');
    expect(openLocal).toHaveBeenCalledWith("/fixture/local"); expect(bridge).not.toHaveBeenCalled();
    await click('[data-cloud-project-id="a"] .onboarding-project-cloud');
    expect(account.active).toBe(true); expect(account.context.projectId).toBe("a");
    expect(JSON.parse(bridge.mock.calls[0][0].body!).target).toEqual({ kind: "project_root", project_id: "a" });
    expect(bridge.mock.calls.every(([request]) => request.method === "GET" || request.path.endsWith("/repository-context"))).toBe(true);
    expect(readCloudProjectHistory(API, "alice").has(cloudHistoryTargetKey({ kind: "project_root", project_id: "a" }))).toBe(true);
  });

  it("opens Cloud-only rows directly without a local folder or intermediate dialog", async () => {
    await render(); await click('[data-cloud-project-id="b"] .onboarding-project-row');
    expect(account.context.projectId).toBe("b"); expect(openLocal).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps local rows usable during loading and after a listing failure; retry stays inline", async () => {
    const pending = deferred<unknown>(); bridge.mockReturnValueOnce(pending.promise);
    await render(); expect(document.body.textContent).toContain("Loading Cloud projects");
    await click(".onboarding-project-row"); expect(openLocal).toHaveBeenCalled();
    await act(async () => pending.resolve([project("a")]));
    bridge.mockRejectedValueOnce(new Error("Offline")); await act(async () => home.refresh());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Projects could not be loaded");
    expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(1);
    await click('[role="alert"] button'); expect(home.status).toBe("ready");
  });

  it("keeps an open failure visible even when a pending catalog refresh finishes, then retries", async () => {
    await render();
    const pending = deferred<unknown>(); const actual = bridge.getMockImplementation()!;
    let fail = true;
    bridge.mockImplementation((request) => request.path.startsWith("/projects/?") ? pending.promise
      : request.path.endsWith("/repository-context") && fail ? Promise.reject(new Error("No access")) : actual(request));
    await act(async () => home.refresh());
    await click('[data-cloud-project-id="b"] .onboarding-project-row');
    await act(async () => pending.resolve([project("a"), project("b")]));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("This project could not be opened");
    expect(account.active).toBe(false); expect(openLocal).not.toHaveBeenCalled();
    fail = false; await click('[role="alert"] button'); expect(account.context.projectId).toBe("b");
  });

  it("cancels a pending open from the inline status without committing late results or history", async () => {
    await render(); const pending = deferred<unknown>(); bridge.mockReturnValueOnce(pending.promise);
    await click('[data-cloud-project-id="b"] .onboarding-project-row');
    expect(buttons().find((button) => button.textContent === "Cancel")).toBeTruthy();
    await click('[role="status"] button');
    await act(async () => pending.resolve({ project: project("b"), target: { kind: "project_root", project_id: "b" } }));
    expect(account.active).toBe(false); expect(account.opening).toBe(false);
    expect(readCloudProjectHistory(API, "alice").size).toBe(0);
  });

  it("discards old-account listing responses and revokes the catalog immediately on sign-out", async () => {
    const pending = deferred<unknown>(); bridge.mockReturnValueOnce(pending.promise);
    await render();
    bridge.mockResolvedValueOnce([project("bob-only")]);
    await render({ currentSession: { ...session, user_id: "bob", session_generation: "two" } });
    expect(document.body.textContent).toContain("Project bob-only");
    await act(async () => pending.resolve([project("alice-only")]));
    expect(document.body.textContent).not.toContain("Project alice-only");
    await render({ currentSession: null });
    expect(document.body.textContent).not.toContain("Project bob-only");
    expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(1);
  });

  it("loads only on the visible enabled Homepage, and revalidates on return or a new session generation", async () => {
    await render({ visible: false }); expect(bridge).not.toHaveBeenCalled();
    await render({ enabled: false }); expect(bridge).not.toHaveBeenCalled();
    await render(); expect(bridge).toHaveBeenCalledTimes(1);
    await render({ currentSession: { ...session, expires_at: session.expires_at + 1000 } }); expect(bridge).toHaveBeenCalledTimes(1);
    await render({ visible: false }); await render(); expect(bridge).toHaveBeenCalledTimes(2);
    await render({ currentSession: { ...session, session_generation: "new" } }); expect(bridge).toHaveBeenCalledTimes(3);
  });

  it("shows an inline empty state when neither location has a project", async () => {
    bridge.mockResolvedValueOnce([]); await render({ localItems: [] });
    expect(document.body.textContent).toContain("No accessible projects in this Cloud account.");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(0);
  });

  it("does not truncate Cloud projects at the old local-recents limit", async () => {
    bridge.mockResolvedValueOnce(Array.from({ length: 55 }, (_, index) => project(String(index))));
    await render(); expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(56);
  });

  it("projects the same Cloud catalog and dual actions into the optional library view", async () => {
    await render({ library: true });
    expect(document.querySelectorAll(".asset-library-card")).toHaveLength(2);
    expect(document.querySelectorAll(".asset-library-project-group")).toHaveLength(2);
    const cloud = buttons().find((button) => button.getAttribute("aria-label")?.includes("in Cloud"));
    expect(cloud).toBeTruthy(); await act(async () => cloud!.click());
    expect(account.context.projectId).toBe("a");
  });
});

describe("Homepage identity and opening order", () => {
  const build = (locals: RecentWorkspaceHomeItem[], cloud = [project("a")]) => buildHomepageProjects({ local: locals, cloud, apiBaseUrl: API });
  it.each([
    { puppyoneGitRemote: null },
    { puppyoneGitRemote: { origin: "https://untrusted.example", projectId: "a" } },
    { puppyoneGitRemote: { origin: "http://cloud-fixture.puppyone.ai", projectId: "a" } },
    { puppyoneGitRemote: { origin: "https://cloud-fixture.puppyone.ai", projectId: "another" } },
    { puppyoneGitRemote: { origin: "https://cloud-fixture.puppyone.ai", projectId: "a", scopeId: "docs" } },
    { hydrationState: "metadata" as const }, { hydrationState: "error" as const },
  ])("does not merge by name, config ID, stale metadata, a foreign origin or Scope (%j)", (patch) => {
    const items = build([{ ...local, workspace: { ...local.workspace, projectId: "a", ...patch } }]);
    expect(items).toHaveLength(2); expect(items[0].localPath).toBe(""); expect(items[1].cloudProjectId).toBeUndefined();
  });
  it("does not treat a local locator as proof of account access", () => {
    expect(build([local], [project("other")]).map((item) => item.cloudProjectId)).toEqual(["other", undefined]);
  });
  it("keeps multiple checkouts distinct, merging the most recently opened one only", () => {
    const next = { ...local, workspace: { ...local.workspace, id: "next", path: "/fixture/next" }, lastOpenedAt: "2026-02-01T00:00:00Z" };
    const items = build([local, next]); expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ cloudProjectId: "a", localPath: "/fixture/next" });
    expect(items[1].localPath).toBe("/fixture/local");
  });
  it("orders both, Cloud and local groups, with actual last-open times ahead of unopened items", () => {
    const history = new Map([[cloudHistoryTargetKey({ kind: "project_root", project_id: "z" }), "2026-03-01T00:00:00Z"]]);
    const localOnly = { workspace: { ...local.workspace, id: "new", path: "/fixture/new", puppyoneGitRemote: null }, lastOpenedAt: "2026-05-01T00:00:00Z" };
    const items = buildHomepageProjects({ local: [localOnly, local], cloud: [project("b"), project("z"), project("a")], apiBaseUrl: API, history });
    expect(items.map((item) => item.cloudProjectId ?? "local")).toEqual(["a", "z", "b", "local"]);
  });
  it("isolates navigation timestamps by connection, account and exact target, tolerating unavailable storage", () => {
    rememberCloudProjectOpen(API, "alice", { kind: "scope", project_id: "a", scope_id: "docs" });
    expect(readCloudProjectHistory(API, "bob").size).toBe(0);
    expect(readCloudProjectHistory("https://other.example/api/v1", "alice").size).toBe(0);
    const items = buildHomepageProjects({ local: [], cloud: [project("a")], apiBaseUrl: API, history: readCloudProjectHistory(API, "alice") });
    expect(items[0].lastOpenedAt).toBeUndefined();
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota"); });
    expect(() => rememberCloudProjectOpen(API, "alice", { kind: "project_root", project_id: "a" })).not.toThrow(); storage.mockRestore();
  });
});
