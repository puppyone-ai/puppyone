/** @vitest-environment happy-dom */
import { WindowNavigationProvider } from "../../../../src/components/WindowNavigation";
import { HeaderSignInButton } from "../../../../src/features/cloud/workbench/CloudAccountButton";
import { workspaceFixtureBridge, fixtureWorkspaceWatch, fileVersion, liveEntry } from "../../../fixtures/cloud/repositories/liveWorkspace";
import { nativeSnapshot } from "../../../fixtures/cloud/repositories/nativeRepository";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { HOMEPAGE_PROJECT_LAYOUT_STORAGE_KEY } from "../../../../src/preferenceStorage";
import { HomeWithEntryFlow } from "../../../support/react/homeWithEntryFlow";
import { useAccountCloudWorkspace, type AccountCloudWorkspace } from "../../../../src/features/cloud/workbench/useAccountCloudWorkspace";
import { useHomepageCloudProjects } from "../../../../src/features/cloud/workbench/useHomepageCloudProjects";
import { HomepageCloudStatus } from "../../../../src/features/cloud/workbench/HomepageCloudStatus";
import { buildHomepageProjects } from "../../../../src/features/cloud/workbench/homepageCloudProjects";
import { latestProjectModifiedAt } from "../../../../src/features/cloud/workbench/homepageCloudActivity";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { RecentWorkspaceHomeItem } from "../../../../src/lib/workspaceHomeModel";
import { withTestLocalization } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const API = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: API, user_id: "alice", user_email: "alice@example.com",
  session_generation: "one", expires_in: 3600, expires_at: Date.now() + 3600000, status: "authenticated" };
const project = (id: string) => ({ id, name: `Project ${id}`, capabilities: ["content.read"] });
const historyFor = (id: string, date: string | null = null) => ({ project_id: id,
  commits: date ? [{ commit_id: "a".repeat(40), parent_ids: [], created_at: date }] : [],
  head_commit_id: date ? "a".repeat(40) : null, refs: [], refs_included: true, snapshot_id: "b".repeat(64),
  has_more: false, next_cursor: null, total: date ? 1 : 0, graph_health: "complete", unreadable_commit_ids: [] });
const local: RecentWorkspaceHomeItem = { workspace: { id: "local", name: "Project a", path: "/fixture/local", status: "recording",
  hydrationState: "ready", lastModifiedAt: "2026-01-01T00:00:00Z", puppyoneGitRemote: { origin: "https://cloud-fixture.puppyone.ai", projectId: "a" } }, lastOpenedAt: "2026-01-01T00:00:00Z" };
let root: Root;
let account: AccountCloudWorkspace;
let home: ReturnType<typeof useHomepageCloudProjects>;
let openLocal: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
let openAccount: ReturnType<typeof vi.fn<() => void>>;
type Request = Parameters<NonNullable<typeof window.puppyoneDesktop>["requestCloudSessionApi"]>[0];
let bridge: ReturnType<typeof vi.fn<(request: Request) => unknown>>;
const appearance = createTestSurfaceAppearance();
function Harness({ currentSession = session, visible = true, enabled = true, localItems = [local] }: {
  currentSession?: DesktopCloudSession | null; visible?: boolean; enabled?: boolean; localItems?: RecentWorkspaceHomeItem[];
}) {
  const [shown, onShow] = useState<"local" | "cloud">("local");
  account = useAccountCloudWorkspace({ enabled, shown, onShow, session: currentSession, apiBaseUrl: API });
  home = useHomepageCloudProjects({ enabled, visible: visible && !account.active, session: currentSession, apiBaseUrl: API, local: localItems });
  const navigation = { account: { session: currentSession, apiBaseUrl: API, onOpenAccount: openAccount }, spaces: [],
    trailing: currentSession ? null : <HeaderSignInButton apiBaseUrl={API} /> };
  return visible && !account.active ? <WindowNavigationProvider value={navigation}><HomeWithEntryFlow appearance={appearance} projectItems={home.items}
    onChooseWorkspace={async () => {}}
    onOpenDroppedWorkspace={async () => {}} onOpenWorkspacePath={openLocal}
    cloudOpening={account.opening} onOpenCloudProject={(id) => void account.openTarget({ kind: "project_root", project_id: id })}
    cloudAccountStatus={<HomepageCloudStatus status={home.status} restoring={false} empty={enabled && home.items.length === 0} apiBaseUrl={API}
      session={currentSession} onOpenAccount={openAccount} controller={account} onRetry={home.refresh} />} /></WindowNavigationProvider> : null;
}
async function render(props: Parameters<typeof Harness>[0] = {}) { await act(async () => root.render(withTestLocalization(<Harness {...props} />))); }
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
async function click(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector); expect(button).toBeTruthy();
  await act(async () => button!.click());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
}
beforeEach(() => {
  localStorage.setItem(HOMEPAGE_PROJECT_LAYOUT_STORAGE_KEY, "list");
  initializeDesktopPreferences();
  bridge = vi.fn(async (request) => {
    if (request.path.startsWith("/projects/?")) return [project("a"), project("b")];
    if (request.path.endsWith("/repository-context")) {
      const { target } = JSON.parse(request.body!); return { project: project(target.project_id), target };
    }
    if (request.path.includes("/commits?")) return historyFor(request.path.split("/")[2]!);
    if (request.path.includes("/workbench/")) return { entries: [], ...nativeSnapshot("head") };
    throw new Error(`Unexpected ${request.path}`);
  });
  openLocal = vi.fn(async () => {});
  openAccount = vi.fn();
  window.puppyoneDesktop = { requestCloudSessionApi: workspaceFixtureBridge(bridge), ...fixtureWorkspaceWatch() } as unknown as NonNullable<typeof window.puppyoneDesktop>;
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; localStorage.clear(); vi.unstubAllEnvs(); });

describe("inline Homepage Cloud projects", () => {
  it("lists a linked folder and its Cloud project as two entries that each open their own project (ADR-001)", async () => {
    await render();
    const localRow = document.querySelector('[data-linked-cloud-project-id="a"]')!;
    const cloudRow = document.querySelector('[data-cloud-project-id="a"]')!;
    expect(localRow).not.toBe(cloudRow);
    expect(localRow.getAttribute("data-project-location")).toBe("local");
    expect(cloudRow.getAttribute("data-project-location")).toBe("cloud");
    expect(cloudRow.textContent).toContain("Cloud project");
    expect(document.body.textContent).not.toMatch(/Last opened on|Opening options/);
    await click('[data-linked-cloud-project-id="a"] .onboarding-project-row');
    expect(openLocal).toHaveBeenCalledWith("/fixture/local");
    expect(account.active).toBe(false);
    await click('[data-cloud-project-id="a"] .onboarding-project-row');
    expect(account.active).toBe(true);
    expect(account.context.projectId).toBe("a");
    expect(openLocal).toHaveBeenCalledOnce();
  });

  it("keeps one list across renders that change none of its sources", async () => {
    const localItems = [local];
    await render({ localItems });
    const settled = home.items;

    await render({ localItems });
    expect(home.items).toBe(settled);

    await render({ localItems: [...localItems] });
    expect(home.items).not.toBe(settled);
  });

  it("never remembers where a project was last opened", async () => {
    await render();
    await click('[data-cloud-project-id="a"] .onboarding-project-row');
    await act(async () => account.useLocal());
    await render();
    expect(Object.keys(localStorage).some((key) => key.startsWith("puppyone.project-open-location"))).toBe(false);
    await click('[data-linked-cloud-project-id="a"] .onboarding-project-row');
    expect(openLocal).toHaveBeenCalledWith("/fixture/local");
  });

  it("automatically loads after login, links by trusted ID, and has no browse button, picker or create form", async () => {
    await render({ currentSession: null });
    expect(bridge).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(1);
    const signIn = buttons().find((button) => button.getAttribute("aria-label") === "Sign in to Puppyone Cloud");
    expect(signIn?.closest(".onboarding-project-list")).toBeNull();
    expect(signIn?.closest(".desktop-titlebar")).not.toBeNull();
    expect(signIn?.querySelector("svg")).toBeNull();
    expect(signIn?.textContent).toBe("Sign in");
    await render();
    expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(3);
    // Two entries, never merged; the Cloud's projects lead the page.
    expect([...document.querySelectorAll(".onboarding-project-group-title")].map((title) => title.textContent))
      .toEqual(["On this computer", "Shared projects"]);
    expect(document.querySelector('[data-linked-cloud-project-id="a"][data-project-location="local"] .onboarding-project-icon')).toBeTruthy();
    expect(document.querySelector('[data-cloud-project-id="a"][data-project-location="cloud"] .onboarding-project-icon')).toBeTruthy();
    expect(document.querySelector('[data-cloud-project-id="b"][data-project-location="cloud"] .onboarding-project-icon')).toBeTruthy();
    expect(document.querySelectorAll('[data-cloud-project-id="a"]')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Browse Cloud projects");
    expect(document.querySelector("form")).toBeNull();
    expect(bridge.mock.calls.map(([request]) => request.path)).toEqual([
      "/projects/?include_access_counts=false", "/content/a/commits?limit=1&order=topo", "/content/b/commits?limit=1&order=topo",
    ]);
  });

  it("leaves the account to the Header's place menu, signed in or out", async () => {
    await render({ enabled: false });
    expect(bridge).not.toHaveBeenCalled();
    expect(document.querySelector(".homepage-cloud-account button")).toBeNull();
    await render({ enabled: false, currentSession: null });
    expect(document.querySelector(".homepage-cloud-account button")).toBeNull();
  });

  it("opens a linked folder locally, while its Cloud project mark opens that other project by its exact ID", async () => {
    await render(); bridge.mockClear();
    await click('[data-linked-cloud-project-id="a"] .onboarding-project-row');
    expect(openLocal).toHaveBeenCalledWith("/fixture/local"); expect(bridge).not.toHaveBeenCalled();
    const link = document.querySelector<HTMLButtonElement>('[data-linked-cloud-project-id="a"] .onboarding-project-cloud-link')!;
    expect(link.getAttribute("aria-label")).toBe("Open Cloud project \u2068Project a\u2069");
    await act(async () => link.click());
    expect(account.active).toBe(true); expect(account.context.projectId).toBe("a");
    expect(JSON.parse(bridge.mock.calls[0][0].body!).target).toEqual({ kind: "project_root", project_id: "a" });
    expect(bridge.mock.calls.every(([request]) => request.method === "GET" || request.path.endsWith("/repository-context"))).toBe(true);
    expect(Object.keys(localStorage).some((key) => key.startsWith("puppyone.cloud-project-history"))).toBe(false);
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
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Unable to open the Cloud project");
    expect(account.active).toBe(false); expect(openLocal).not.toHaveBeenCalled();
    fail = false; await click('[role="alert"] button'); expect(account.context.projectId).toBe("b");
  });

  it("cancels a pending Cloud open without committing late results", async () => {
    await render(); const pending = deferred<unknown>(); bridge.mockReturnValueOnce(pending.promise);
    const projectButton = buttons().find(button => button.getAttribute("aria-label")?.includes("Project b"));
    await act(async () => projectButton!.click());
    expect(document.querySelector(".desktop-titlebar [role='status']")).toBeNull();
    expect(document.querySelector(".desktop-titlebar")?.textContent).not.toContain("Opening");
    await act(async () => account.cancel());
    await act(async () => pending.resolve({ project: project("b"), target: { kind: "project_root", project_id: "b" } }));
    expect(account.active).toBe(false); expect(account.opening).toBe(false);
    expect(Object.keys(localStorage).some((key) => key.startsWith("puppyone.cloud-project-history"))).toBe(false);
  });

  it("publishes the project and its progress while the workspace prepares, and drops both on cancel", async () => {
    await render(); const listing = deferred<unknown>();
    bridge.mockImplementation(async (request) => {
      if (request.path.endsWith("/repository-context")) return { project: project("b"), target: { kind: "project_root", project_id: "b" } };
      if (request.path.includes("/workbench/files")) return listing.promise;
      throw new Error(`Unexpected ${request.path}`);
    });
    await click('[data-cloud-project-id="b"] .onboarding-project-row');
    expect(account.openingTarget?.project_id).toBe("b");
    expect(account.preparation?.projectName).toBe("Project b");
    expect(account.preparation?.progress?.getSnapshot()).toBe("files");
    expect(account.active).toBe(false);
    await act(async () => account.cancel());
    expect(account.opening).toBe(false);
    expect(account.preparation).toBeNull();
    await act(async () => listing.resolve({ entries: [] }));
    expect(account.active).toBe(false);
    expect(account.preparation).toBeNull();
  });

  it("blocks a repeated local open and restores interaction after failure", async () => {
    const pending = deferred<void>(); openLocal.mockReturnValueOnce(pending.promise);
    await render({ enabled: false });
    const selector = ".onboarding-project-row";
    await click(selector);
    await click(selector);
    expect(openLocal).toHaveBeenCalledOnce();
    await act(async () => pending.reject(new Error("Folder unavailable")));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Folder unavailable");
    expect(document.querySelector<HTMLButtonElement>(selector)?.disabled).toBe(false);
  });

  it("exposes retry after a Cloud open fails", async () => {
    await render(); const pending = deferred<unknown>(); bridge.mockReturnValueOnce(pending.promise);
    await act(async () => buttons().find(button => button.getAttribute("aria-label")?.includes("Project b"))!.click());
    await act(async () => pending.reject(new Error("No access")));
    expect(account.active).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Unable to open the Cloud project");
    expect(buttons().find(button => button.textContent === "Retry")?.disabled).toBe(false);
  });

  it("discards old-account listing responses and revokes the catalog immediately on sign-out", async () => {
    const pending = deferred<unknown>(); bridge.mockReturnValueOnce(pending.promise);
    await render();
    bridge.mockResolvedValueOnce([project("bob-only")]);
    await render({ currentSession: { ...session, user_id: "bob", session_generation: "two" } });
    expect(document.body.textContent).toContain("Project bob-only");
    await act(async () => pending.resolve([project("alice-only")]));
    expect(document.body.textContent).not.toContain("Project alice-only");
    localStorage.setItem("puppyone.desktop.cloud-spaces.v1", JSON.stringify({ scope: "bob", spaces: [] }));
    await render({ currentSession: null });
    expect(document.body.textContent).not.toContain("Project bob-only");
    expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(1);
    // Nothing of the account stays on this computer for whoever signs in next.
    expect(Object.keys(localStorage).filter((key) => /cloud-(project-catalog|organization-names|spaces)/.test(key))).toEqual([]);
  });

  it("loads only on the visible enabled Homepage, and revalidates on return or a new session generation", async () => {
    await render({ visible: false }); expect(bridge).not.toHaveBeenCalled();
    await render({ enabled: false }); expect(bridge).not.toHaveBeenCalled();
    const listings = () => bridge.mock.calls.filter(([request]) => request.path.startsWith("/projects/?"));
    await render(); expect(listings()).toHaveLength(1);
    await render({ currentSession: { ...session, expires_at: session.expires_at + 1000 } }); expect(listings()).toHaveLength(1);
    await render({ visible: false }); await render(); expect(listings()).toHaveLength(2);
    await render({ currentSession: { ...session, session_generation: "new" } }); expect(listings()).toHaveLength(3);
  });

  it("shows an inline empty state when neither location has a project", async () => {
    bridge.mockResolvedValueOnce([]); await render({ localItems: [] });
    expect(document.body.textContent).toContain("No accessible projects in this Cloud account.");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(0);
  });

  it("enriches ordering with actual content history instead of treating project metadata as a content clock", async () => {
    const actual = bridge.getMockImplementation()!;
    bridge.mockImplementation((request) => request.path.includes("/b/commits?")
      ? historyFor("b", "2026-06-01T00:00:00Z") : actual(request));
    await render();
    expect(home.items[0]).toMatchObject({ cloudProjectId: "b", lastModifiedAt: "2026-06-01T00:00:00.000Z" });
    expect(account.active).toBe(false);
    expect(bridge.mock.calls.every(([request]) => !request.path.endsWith("/files"))).toBe(true);
  });

  it("bounds activity reads and stops queued work when Homepage is hidden", async () => {
    const pending = deferred<unknown>();
    bridge.mockImplementation((request) => request.path.startsWith("/projects/?")
      ? Array.from({ length: 12 }, (_, i) => project(String(i))) : pending.promise);
    await render(); expect(home.items).toHaveLength(13);
    expect(bridge.mock.calls.filter(([request]) => request.path.includes("/commits?")).length).toBe(4);
    await render({ visible: false });
    await act(async () => pending.resolve(historyFor("0", "2099-01-01T00:00:00Z")));
    expect(bridge.mock.calls.filter(([request]) => request.path.includes("/commits?")).length).toBe(4);
    expect(home.items.some((item) => item.lastModifiedAt?.startsWith("2099"))).toBe(false);
  });

  it("never applies old-account activity to the next account's matching Project IDs", async () => {
    const pending = deferred<unknown>(); const actual = bridge.getMockImplementation()!;
    bridge.mockImplementation((request) => request.path.includes("/commits?") && request.expectedSession.userId === "alice"
      ? pending.promise : actual(request));
    await render();
    await render({ currentSession: { ...session, user_id: "bob", session_generation: "two" } });
    await act(async () => pending.resolve(historyFor("b", "2099-01-01T00:00:00Z")));
    expect(home.items.some((item) => item.lastModifiedAt?.startsWith("2099"))).toBe(false);
    expect(bridge.mock.calls.filter(([request]) => request.path.includes("/commits?")).map(([request]) => request.expectedSession.userId))
      .toEqual(["alice", "alice", "bob", "bob"]);
  });

  it("takes a renamed or deleted project from the server, quietly, and a read in flight cannot undo it", async () => {
    const activity = deferred<unknown>(); const relisting = deferred<void>(); const actual = bridge.getMockImplementation()!;
    let catalog = [project("a"), project("b")]; let listings = 0;
    bridge.mockImplementation(async (request) => {
      const id = decodeURIComponent(request.path.split("/")[2] ?? "");
      if (request.method === "DELETE") { catalog = catalog.filter((entry) => entry.id !== id); return { status: "pending" }; }
      if (request.method === "PUT") {
        catalog = catalog.map((entry) => entry.id === id ? { ...entry, ...JSON.parse(request.body!) } : entry);
        return catalog.find((entry) => entry.id === id);
      }
      if (request.path.startsWith("/projects/?")) { if (++listings > 1) await relisting.promise; return catalog; }
      return request.path.includes("/commits?") && listings === 1 ? activity.promise : actual(request);
    });
    await render();
    const cloudNames = () => home.items.filter((item) => item.cloudProjectId).map((item) => item.label).sort();

    await act(async () => home.deleteProject!("b"));
    expect(cloudNames()).toEqual(["Project a"]);
    expect(home.status).toBe("ready");
    await act(async () => activity.resolve(historyFor("b", "2026-01-01T00:00:00Z")));
    expect(cloudNames()).toEqual(["Project a"]);
    await act(async () => relisting.resolve());
    expect(cloudNames()).toEqual(["Project a"]);

    await act(async () => home.renameProject!("a", "Renamed"));
    expect(cloudNames()).toEqual(["Renamed"]);
    expect(home.items.find((item) => item.localPath)?.linkedCloudProject).toEqual({ id: "a", name: "Renamed" });
    const cachedNames = () => JSON.parse(localStorage.getItem("puppyone.desktop.cloud-project-catalog.v1")!).projects.map(({ name }: { name: string }) => name);
    expect(cachedNames()).toEqual(["Renamed"]);
    const [deletion] = bridge.mock.calls.map(([request]) => request).filter(({ method }) => method === "DELETE");
    expect(deletion?.path).toBe("/projects/b");
  });

  it("offers no Cloud changes without a session, and a refused one leaves the catalog alone", async () => {
    await render({ currentSession: null }); expect(home.deleteProject).toBeUndefined();
    const actual = bridge.getMockImplementation()!;
    bridge.mockImplementation((request) => request.method === "DELETE" ? Promise.reject(new Error("Forbidden")) : actual(request));
    await render();
    await act(async () => { await expect(home.deleteProject!("b")).rejects.toThrow("Forbidden"); });
    expect(home.items.some((item) => item.cloudProjectId === "b")).toBe(true);
  });

  it("does not truncate Cloud projects at the old local-recents limit", async () => {
    bridge.mockResolvedValueOnce(Array.from({ length: 55 }, (_, index) => project(String(index))));
    await render(); expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(56);
  });
});

describe("Homepage identity and modification order", () => {
  const build = (locals: RecentWorkspaceHomeItem[], cloud = [project("a")]) => buildHomepageProjects({ local: locals, cloud, apiBaseUrl: API });
  it.each([
    { puppyoneGitRemote: null },
    { puppyoneGitRemote: { origin: "https://untrusted.example", projectId: "a" } },
    { puppyoneGitRemote: { origin: "http://cloud-fixture.puppyone.ai", projectId: "a" } },
    { puppyoneGitRemote: { origin: "https://cloud-fixture.puppyone.ai", projectId: "another" } },
    { puppyoneGitRemote: { origin: "https://cloud-fixture.puppyone.ai", projectId: "a", scopeId: "docs" } },
    { hydrationState: "metadata" as const }, { hydrationState: "error" as const },
  ])("does not link by name, config ID, stale metadata, a foreign origin or Scope (%j)", (patch) => {
    const items = build([{ ...local, workspace: { ...local.workspace, projectId: "a", ...patch } }]);
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.cloudProjectId)?.localPath).toBe("");
    expect(items.find((item) => item.localPath)).not.toHaveProperty("cloudProjectId");
    expect(items.find((item) => item.localPath)).not.toHaveProperty("linkedCloudProject");
  });
  it("gives a Cloud entry only the actions the account's grant holds", () => {
    const actions = (capabilities: string[]) => build([], [{ ...project("a"), capabilities }])[0]?.cloudActions;
    expect(actions(["content.read"])).toEqual({ rename: false, delete: false });
    expect(actions(["project.settings.manage"])).toEqual({ rename: true, delete: false });
    expect(actions(["project.delete"])).toEqual({ rename: false, delete: true });
    expect(build([local]).find((item) => item.localPath)).not.toHaveProperty("cloudActions");
  });
  it("does not treat a local locator as proof of account access", () => {
    expect(build([local], [project("other")]).find((item) => item.localPath)?.linkedCloudProject).toBeUndefined();
  });
  it("never merges a folder into its Cloud project; every checkout keeps its own entry and link", () => {
    const next = { ...local, workspace: { ...local.workspace, id: "next", path: "/fixture/next", lastModifiedAt: "2026-02-01T00:00:00Z" } };
    const items = build([local, next]); expect(items).toHaveLength(3);
    expect(items.filter((item) => item.localPath).map((item) => [item.localPath, item.linkedCloudProject]))
      .toEqual([["/fixture/next", { id: "a", name: "Project a" }], ["/fixture/local", { id: "a", name: "Project a" }]]);
    expect(items.find((item) => item.cloudProjectId === "a")).toMatchObject({ localPath: "", label: "Project a" });
    expect(items.every((item) => !(item.localPath && item.cloudProjectId))).toBe(true);
  });
  it("sorts the entire list by modification, without location rank or opening-time fallback", () => {
    const activity = new Map([["z", "2026-03-01T00:00:00Z"]]);
    const localOnly = { workspace: { ...local.workspace, id: "new", path: "/fixture/new", puppyoneGitRemote: null,
      lastModifiedAt: "2026-05-01T00:00:00Z" }, lastOpenedAt: "2025-01-01T00:00:00Z" };
    const reopened = { ...local, lastOpenedAt: "2099-01-01T00:00:00Z" };
    const items = buildHomepageProjects({ local: [localOnly, reopened], cloud: [project("b"), project("z"), project("a")], apiBaseUrl: API, activity });
    expect(items.map((item) => item.cloudProjectId ?? "local")).toEqual(["local", "z", "local", "a", "b"]);
  });
  it("dates each entry by its own updates, with unknown/invalid dates last", () => {
    const items = buildHomepageProjects({ local: [local], cloud: [{ ...project("a"), updated_at: "2026-06-01T00:00:00Z" },
      { ...project("b"), updated_at: "not-a-date" }], apiBaseUrl: API });
    expect(items.map((item) => [item.cloudProjectId ?? "local", item.lastModifiedAt])).toEqual([
      ["a", "2026-06-01T00:00:00.000Z"], ["local", "2026-01-01T00:00:00Z"], ["b", null]]);
    expect(latestProjectModifiedAt(null, undefined, "invalid")).toBeNull();
  });
});
