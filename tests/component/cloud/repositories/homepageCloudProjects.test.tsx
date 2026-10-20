import { workspaceFixtureBridge, fixtureWorkspaceWatch, fileVersion, liveEntry } from "../../../fixtures/cloud/repositories/liveWorkspace";
import { nativeSnapshot } from "../../../fixtures/cloud/repositories/nativeRepository";
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
import { latestProjectModifiedAt } from "../../../../src/features/cloud/workbench/homepageCloudActivity";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { RecentWorkspaceHomeItem } from "../../../../src/features/app-shell/workspaceHomeModel";
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
function Harness({ currentSession = session, visible = true, enabled = true, library = false, localItems = [local] }: {
  currentSession?: DesktopCloudSession | null; visible?: boolean; enabled?: boolean; library?: boolean; localItems?: RecentWorkspaceHomeItem[];
}) {
  account = useAccountCloudWorkspace({ enabled, session: currentSession, apiBaseUrl: API });
  home = useHomepageCloudProjects({ enabled, visible: visible && !account.active, session: currentSession, apiBaseUrl: API, local: localItems });
  const Home = library ? AssetLibraryHome : MinimalOnboarding;
  return visible && !account.active ? <Home appearance={appearance} projectItems={home.items}
    onChooseWorkspace={async () => {}}
    onOpenDroppedWorkspace={async () => {}} onOpenWorkspacePath={openLocal}
    cloudOpening={account.opening} onOpenCloudProject={(id) => void account.openTarget({ kind: "project_root", project_id: id })}
    onCancelCloudOpening={account.cancel}
    cloudAccountStatus={<HomepageCloudStatus status={home.status} restoring={false} empty={enabled && home.items.length === 0} apiBaseUrl={API}
      session={currentSession} onOpenAccount={openAccount} controller={account} onRetry={home.refresh} />} /> : null;
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
  it("automatically loads after login, merges by trusted ID, and has no browse button, picker or create form", async () => {
    await render({ currentSession: null });
    expect(bridge).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(1);
    const signIn = buttons().find((button) => button.getAttribute("aria-label") === "Sign in to Puppyone Cloud");
    expect(signIn?.closest(".onboarding-project-list")).toBeNull();
    expect(signIn?.closest(".desktop-titlebar")).not.toBeNull();
    expect(signIn?.querySelector("svg")).toBeNull();
    expect(signIn?.textContent).toBe("Sign in");
    await render();
    expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(2);
    expect(document.querySelector(".onboarding-project-group")).toBeNull();
    expect(document.querySelector('[data-cloud-project-id="a"] [data-project-location="linked"]')).toBeTruthy();
    expect(document.querySelector('[data-cloud-project-id="b"] [data-project-location="cloud"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-cloud-project-id="a"]')).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Browse Cloud projects");
    expect(document.querySelector("form")).toBeNull();
    expect(bridge.mock.calls.map(([request]) => request.path)).toEqual([
      "/projects/?include_access_counts=false", "/content/a/commits?limit=1&order=topo", "/content/b/commits?limit=1&order=topo",
    ]);
  });

  it("keeps the account avatar available without the Cloud experiment and opens account settings", async () => {
    await render({ enabled: false });
    expect(bridge).not.toHaveBeenCalled();
    expect(document.querySelector(".homepage-cloud-sign-in")).toBeNull();
    const avatar = document.querySelector<HTMLButtonElement>(".homepage-cloud-avatar");
    expect(avatar?.textContent).toBe("A");
    expect(avatar?.getAttribute("aria-label")).toContain("alice@example.com");
    await click(".homepage-cloud-avatar");
    expect(openAccount).toHaveBeenCalledOnce();
    await render({ enabled: false, currentSession: null });
    expect(document.querySelector(".homepage-cloud-avatar")).toBeNull();
    expect(document.querySelector(".homepage-cloud-sign-in")?.textContent).toBe("Sign in");
  });

  it("opens a merged row locally by default, while its explicit Cloud action authorizes the exact ID", async () => {
    await render(); bridge.mockClear();
    await click('[data-cloud-project-id="a"] .onboarding-project-row');
    expect(openLocal).toHaveBeenCalledWith("/fixture/local"); expect(bridge).not.toHaveBeenCalled();
    await click('[data-cloud-project-id="a"] .onboarding-project-cloud');
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
    expect(document.querySelector(".homepage-cloud-avatar")).not.toBeNull();
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

  it.each([false, true])("cancels a pending Cloud open from the page overlay without committing late results (cards=%s)", async library => {
    await render({ library }); const pending = deferred<unknown>(); bridge.mockReturnValueOnce(pending.promise);
    const projectButton = buttons().find(button => button.getAttribute("aria-label")?.includes("Project b"));
    projectButton!.focus();
    await act(async () => projectButton!.click());
    const overlay = document.querySelector<HTMLElement>(".onboarding-project-loading");
    const page = document.querySelector<HTMLElement>(library ? ".asset-library-home" : ".onboarding-homepage");
    expect(overlay?.textContent).toContain("Loading project");
    expect(overlay?.querySelector("button")?.textContent).toBe("Cancel");
    expect(document.querySelector(".desktop-titlebar [role='status']")).toBeNull();
    expect(document.querySelector(".desktop-titlebar")?.textContent).not.toContain("Opening");
    expect(page?.inert).toBe(true);
    expect(document.activeElement).toBe(overlay);
    await click('.onboarding-project-loading button');
    expect(document.querySelector(".onboarding-project-loading")).toBeNull();
    expect(page?.inert).toBe(false);
    expect(document.activeElement).toBe(projectButton);
    await act(async () => pending.resolve({ project: project("b"), target: { kind: "project_root", project_id: "b" } }));
    expect(account.active).toBe(false); expect(account.opening).toBe(false);
    expect(Object.keys(localStorage).some((key) => key.startsWith("puppyone.cloud-project-history"))).toBe(false);
  });

  it.each([false, true])("covers pending local opens and restores interaction after failure (cards=%s)", async library => {
    const pending = deferred<void>(); openLocal.mockReturnValueOnce(pending.promise);
    await render({ library, enabled: false });
    const selector = library ? ".asset-library-card-main" : ".onboarding-project-row";
    const projectButton = document.querySelector<HTMLButtonElement>(selector)!;
    projectButton.focus();
    await click(selector);
    const page = document.querySelector<HTMLElement>(library ? ".asset-library-home" : ".onboarding-homepage");
    expect(document.querySelector(".onboarding-project-loading")?.textContent).toBe("Loading project");
    expect(document.querySelector(".onboarding-project-loading button")).toBeNull();
    expect(page?.inert).toBe(true);
    await click(selector);
    expect(openLocal).toHaveBeenCalledOnce();
    await act(async () => pending.reject(new Error("Folder unavailable")));
    expect(document.querySelector(".onboarding-project-loading")).toBeNull();
    expect(page?.inert).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Folder unavailable");
    expect(document.querySelector<HTMLButtonElement>(selector)?.disabled).toBe(false);
    expect(document.activeElement).toBe(projectButton);
  });

  it.each([false, true])("clears the page overlay and exposes retry after a Cloud open fails (cards=%s)", async library => {
    await render({ library }); const pending = deferred<unknown>(); bridge.mockReturnValueOnce(pending.promise);
    await act(async () => buttons().find(button => button.getAttribute("aria-label")?.includes("Project b"))!.click());
    expect(document.querySelector(".onboarding-project-loading")).not.toBeNull();
    await act(async () => pending.reject(new Error("No access")));
    expect(document.querySelector(".onboarding-project-loading")).toBeNull();
    expect(account.active).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("This project could not be opened");
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
    await render({ currentSession: null });
    expect(document.body.textContent).not.toContain("Project bob-only");
    expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(1);
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

  it("does not truncate Cloud projects at the old local-recents limit", async () => {
    bridge.mockResolvedValueOnce(Array.from({ length: 55 }, (_, index) => project(String(index))));
    await render(); expect(document.querySelectorAll(".onboarding-project-row-wrap")).toHaveLength(56);
  });

  it("projects the same Cloud catalog and dual actions into the optional library view", async () => {
    await render({ library: true });
    expect(document.querySelectorAll(".asset-library-card")).toHaveLength(2);
    expect(document.querySelector(".asset-library-project-group")).toBeNull();
    const cloud = buttons().find((button) => button.getAttribute("aria-label")?.includes("in Cloud"));
    expect(cloud).toBeTruthy(); await act(async () => cloud!.click());
    expect(account.context.projectId).toBe("a");
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
  ])("does not merge by name, config ID, stale metadata, a foreign origin or Scope (%j)", (patch) => {
    const items = build([{ ...local, workspace: { ...local.workspace, projectId: "a", ...patch } }]);
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.cloudProjectId)?.localPath).toBe("");
    expect(items.find((item) => item.localPath)?.cloudProjectId).toBeUndefined();
  });
  it("does not treat a local locator as proof of account access", () => {
    expect(build([local], [project("other")]).find((item) => item.localPath)?.cloudProjectId).toBeUndefined();
  });
  it("keeps multiple checkouts distinct, merging the most recently modified one only", () => {
    const next = { ...local, workspace: { ...local.workspace, id: "next", path: "/fixture/next", lastModifiedAt: "2026-02-01T00:00:00Z" } };
    const items = build([local, next]); expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ cloudProjectId: "a", localPath: "/fixture/next" });
    expect(items[1].localPath).toBe("/fixture/local");
  });
  it("sorts the entire list by modification, without location rank or opening-time fallback", () => {
    const activity = new Map([["z", "2026-03-01T00:00:00Z"]]);
    const localOnly = { workspace: { ...local.workspace, id: "new", path: "/fixture/new", puppyoneGitRemote: null,
      lastModifiedAt: "2026-05-01T00:00:00Z" }, lastOpenedAt: "2025-01-01T00:00:00Z" };
    const reopened = { ...local, lastOpenedAt: "2099-01-01T00:00:00Z" };
    const items = buildHomepageProjects({ local: [localOnly, reopened], cloud: [project("b"), project("z"), project("a")], apiBaseUrl: API, activity });
    expect(items.map((item) => item.cloudProjectId ?? "local")).toEqual(["local", "z", "a", "b"]);
  });
  it("uses the later actual update of a merged project, with unknown/invalid dates last", () => {
    const items = buildHomepageProjects({ local: [local], cloud: [{ ...project("a"), updated_at: "2026-06-01T00:00:00Z" },
      { ...project("b"), updated_at: "not-a-date" }], apiBaseUrl: API });
    expect(items[0].lastModifiedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(items[1].lastModifiedAt).toBeNull();
    expect(latestProjectModifiedAt(null, undefined, "invalid")).toBeNull();
  });
});
