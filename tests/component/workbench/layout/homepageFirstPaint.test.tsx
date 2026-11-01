/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinimalOnboarding } from "../../../../src/components/MinimalOnboarding";
import {
  HOMEPAGE_FIRST_PAINT_BUDGET_MS,
  useHomepageFirstPaint,
} from "../../../../src/features/app-shell/useHomepageFirstPaint";
import { useHomepageCloudProjects } from "../../../../src/features/cloud/workbench/useHomepageCloudProjects";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type { RecentWorkspaceHomeItem } from "../../../../src/lib/workspaceHomeModel";
import { workspaceFixtureBridge, fixtureWorkspaceWatch } from "../../../fixtures/cloud/repositories/liveWorkspace";
import { withTestLocalization } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const API = "https://cloud-fixture.puppyone.ai/api/v1";
const CACHE_KEY = "puppyone.desktop.cloud-project-activity.v1";
const CATALOG_KEY = "puppyone.desktop.cloud-project-catalog.v1";
const scopeOf = (user: string) => JSON.stringify([API, user]);
const appearance = createTestSurfaceAppearance();
const account = (user_id: string, session_generation = "one"): DesktopCloudSession => ({ api_base_url: API, user_id,
  user_email: `${user_id}@example.com`, session_generation, expires_in: 3600, expires_at: Date.now() + 3600000, status: "authenticated" });
const alice = account("alice");
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
};
const history = (id: string, date: string) => ({ project_id: id,
  commits: [{ commit_id: "a".repeat(40), parent_ids: [], created_at: date }], head_commit_id: "a".repeat(40), refs: [],
  refs_included: true, snapshot_id: "b".repeat(64), has_more: false, next_cursor: null, total: 1, graph_health: "complete",
  unreadable_commit_ids: [] });
const metadata = (name: string): RecentWorkspaceHomeItem => ({ workspace: { id: name, name, path: `/fixture/${name}`,
  status: "protected", hydrationState: "metadata" } });
const hydrated = (name: string, lastModifiedAt: string): RecentWorkspaceHomeItem => ({ workspace: { ...metadata(name).workspace,
  hydrationState: "ready", lastModifiedAt } });
const cloudProjects = [
  { id: "old", name: "cloud-old", capabilities: ["content.read"], updated_at: "2026-05-01T00:00:00Z" },
  { id: "new", name: "cloud-new", capabilities: ["content.read"], updated_at: "2026-06-01T00:00:00Z" },
];
const metadataLocal = [metadata("alpha"), metadata("gamma")];
const hydratedLocal = [hydrated("gamma", "2026-10-29T00:00:00Z"), hydrated("alpha", "2026-09-01T00:00:00Z")];
const finalOrder = ["gamma", "cloud-old", "alpha", "cloud-new"];

function Harness({ local, localSettled, restoring = false, sessionRestoring = false, session = alice }: {
  local: RecentWorkspaceHomeItem[]; localSettled: boolean; restoring?: boolean; sessionRestoring?: boolean; session?: DesktopCloudSession | null;
}) {
  const catalog = useHomepageCloudProjects({ visible: !restoring, enabled: true, session, restoring: sessionRestoring, apiBaseUrl: API, local });
  const ready = useHomepageFirstPaint({ restoring, settled: localSettled && !sessionRestoring && catalog.settled,
    account: catalog.account, accountRestoring: sessionRestoring });
  return ready ? <MinimalOnboarding appearance={appearance} projectItems={catalog.items} onChooseWorkspace={async () => {}}
    onOpenDroppedWorkspace={async () => {}} onOpenWorkspacePath={async () => {}} /> : <p data-holding />;
}

let root: Root;
let listing: ReturnType<typeof deferred<unknown>>;
let reads: Map<string, ReturnType<typeof deferred<unknown>>>;
const render = (props: Parameters<typeof Harness>[0]) => act(async () => root.render(withTestLocalization(<Harness {...props} />)));
const rows = () => [...document.querySelectorAll(".onboarding-project-row-wrap bdi:first-of-type")]
  .map((name) => name.textContent).filter((name) => !name?.startsWith("/") && !name?.startsWith("~") && name !== "Cloud project");
const holding = () => document.querySelector("[data-holding]") !== null;
const listed = () => act(async () => listing.resolve(cloudProjects));
const historyArrives = () => act(async () => {
  reads.get("old")!.resolve(history("old", "2026-10-01T00:00:00Z"));
  reads.get("new")!.resolve(history("new", "2026-07-01T00:00:00Z"));
});

beforeEach(() => {
  listing = deferred(); reads = new Map(cloudProjects.map(({ id }) => [id, deferred()]));
  const bridge = vi.fn(async (request: { path: string }) => request.path.startsWith("/projects/?")
    ? listing.promise : reads.get(request.path.split("/")[2]!)!.promise);
  window.puppyoneDesktop = { requestCloudSessionApi: workspaceFixtureBridge(bridge as never), ...fixtureWorkspaceWatch() } as unknown as NonNullable<typeof window.puppyoneDesktop>;
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = ""; localStorage.clear(); vi.useRealTimers();
});

describe("first Homepage paint", () => {
  it.each([
    ["Cloud answers first", [listed, historyArrives, () => render({ local: hydratedLocal, localSettled: true })]],
    ["local folders answer first", [() => render({ local: hydratedLocal, localSettled: true }), listed, historyArrives]],
  ] as const)("shows the list once, in final order, when %s", async (_name, arrivals) => {
    await render({ local: metadataLocal, localSettled: false });
    for (const arrival of arrivals.slice(0, -1)) {
      await arrival();
      expect(holding()).toBe(true);
      expect(rows()).toEqual([]);
    }
    await arrivals.at(-1)!();
    expect(holding()).toBe(false);
    expect(rows()).toEqual(finalOrder);
  });

  it("waits for the signed-in session, because signed out is not yet known while it restores", async () => {
    await render({ local: hydratedLocal, localSettled: true, sessionRestoring: true });
    await listed(); await historyArrives();
    expect(holding()).toBe(true);
    await render({ local: hydratedLocal, localSettled: true });
    expect(rows()).toEqual(finalOrder);
  });

  it("waits for the real order even when it has last known dates", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ scope: JSON.stringify([API, "alice"]),
      activity: { old: "2026-10-01T00:00:00Z", new: "2026-07-01T00:00:00Z" } }));
    await render({ local: hydratedLocal, localSettled: true });
    await listed();
    expect(holding()).toBe(true);
    await historyArrives();
    expect(holding()).toBe(false);
    expect(rows()).toEqual(finalOrder);
  });

  it("keeps cached dates across a new session generation, and reuses what this launch learned", async () => {
    await render({ local: hydratedLocal, localSettled: true });
    await listed(); await historyArrives();
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!).activity).toEqual({ old: "2026-10-01T00:00:00.000Z", new: "2026-07-01T00:00:00.000Z" });
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    listing = deferred(); reads = new Map(cloudProjects.map(({ id }) => [id, deferred()]));
    await render({ local: hydratedLocal, localSettled: true, session: account("alice", "two") });
    await listed();
    await act(async () => { for (const read of reads.values()) read.reject(new Error("Denied")); });
    expect(rows()).toEqual(finalOrder);
  });

  it("keeps a project's last known date when its history read fails, so it does not move", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ scope: JSON.stringify([API, "alice"]),
      activity: { old: "2026-10-01T00:00:00Z", new: "2026-07-01T00:00:00Z" } }));
    await render({ local: hydratedLocal, localSettled: true });
    await listed();
    await act(async () => { reads.get("old")!.reject(new Error("Denied")); reads.get("new")!.resolve(history("new", "2026-07-01T00:00:00Z")); });
    expect(rows()).toEqual(finalOrder);
  });

  it("never dates a project from another account's cache", async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ scope: JSON.stringify([API, "bob"]), activity: { old: "2026-12-01T00:00:00Z" } }));
    await render({ local: hydratedLocal, localSettled: true });
    await listed();
    expect(holding()).toBe(true);
    await historyArrives();
    expect(rows()).toEqual(finalOrder);
  });

  it("does not let unknown or malformed cache data hold or break the list", async () => {
    localStorage.setItem(CACHE_KEY, "{not json");
    await render({ local: hydratedLocal, localSettled: true });
    await listed(); await historyArrives();
    expect(rows()).toEqual(finalOrder);
  });

  it("shows local projects at once when the Cloud listing fails", async () => {
    await render({ local: hydratedLocal, localSettled: true });
    await act(async () => listing.reject(new Error("Offline")));
    expect(rows()).toEqual(["gamma", "alpha"]);
  });

  it("stops waiting at the budget when Cloud never answers, and only counts time after restoration", async () => {
    vi.useFakeTimers();
    await render({ local: hydratedLocal, localSettled: true, restoring: true });
    await act(async () => { vi.advanceTimersByTime(HOMEPAGE_FIRST_PAINT_BUDGET_MS * 3); });
    expect(holding()).toBe(true);
    await render({ local: hydratedLocal, localSettled: true });
    await act(async () => { vi.advanceTimersByTime(HOMEPAGE_FIRST_PAINT_BUDGET_MS - 1); });
    expect(holding()).toBe(true);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(rows()).toEqual(["gamma", "alpha"]);
  });

  it("does not restart the budget when one source settles, or hide the Homepage again on a later reload", async () => {
    vi.useFakeTimers();
    await render({ local: metadataLocal, localSettled: false });
    await act(async () => { vi.advanceTimersByTime(HOMEPAGE_FIRST_PAINT_BUDGET_MS - 1); });
    await render({ local: hydratedLocal, localSettled: true });
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(holding()).toBe(false);
    await render({ local: hydratedLocal, localSettled: false, sessionRestoring: true, session: account("alice", "two") });
    expect(holding()).toBe(false);
    expect(rows()).toEqual(["gamma", "alpha"]);
  });
});

describe("a Homepage that never shows part of its list", () => {
  const cacheList = (user = "alice", projects: unknown = cloudProjects) => {
    localStorage.setItem(CATALOG_KEY, JSON.stringify({ scope: scopeOf(user), projects }));
    localStorage.setItem(CACHE_KEY, JSON.stringify({ scope: scopeOf(user), activity: { old: "2026-10-01T00:00:00Z", new: "2026-07-01T00:00:00Z" } }));
  };
  const home = { local: hydratedLocal, localSettled: true };

  it("remembers only what the list needs from the catalog", async () => {
    await render(home);
    await act(async () => listing.resolve(cloudProjects.map((project) => ({ ...project, description: "private notes", org_id: "org" }))));
    const cached = JSON.parse(localStorage.getItem(CATALOG_KEY)!);
    expect(cached.scope).toBe(scopeOf("alice"));
    expect(cached.projects[0]).toEqual(cloudProjects[0]);
  });

  it("holds a returning account's list until its real order is known", async () => {
    cacheList();
    await render(home);
    expect(holding()).toBe(true);
    await listed();
    expect(holding()).toBe(true);
    await historyArrives();
    expect(holding()).toBe(false);
    expect(rows()).toEqual(finalOrder);
  });

  it("shows the last known order when Cloud outlasts the wait, and does not move it afterwards", async () => {
    vi.useFakeTimers();
    cacheList();
    await render(home);
    await act(async () => { await vi.advanceTimersByTimeAsync(HOMEPAGE_FIRST_PAINT_BUDGET_MS); });
    expect(rows()).toEqual(finalOrder);

    await listed();
    await act(async () => {
      reads.get("old")!.resolve(history("old", "2026-05-01T00:00:00Z"));
      reads.get("new")!.resolve(history("new", "2026-12-01T00:00:00Z"));
    });
    expect(rows()).toEqual(finalOrder);
  });

  it("takes rows the fresh list adds or removes, without emptying the list", async () => {
    vi.useFakeTimers();
    cacheList();
    await render(home);
    await act(async () => { await vi.advanceTimersByTimeAsync(HOMEPAGE_FIRST_PAINT_BUDGET_MS); });
    await act(async () => listing.resolve([cloudProjects[1]]));
    expect(rows()).toEqual(["gamma", "alpha", "cloud-new"]);
    expect(JSON.parse(localStorage.getItem(CATALOG_KEY)!).projects.map(({ id }: { id: string }) => id)).toEqual(["new"]);
  });

  it("does not move a row whose local date arrives after it is on screen", async () => {
    await render({ ...home, session: null });
    expect(rows()).toEqual(["gamma", "alpha"]);
    await render({ ...home, session: null, local: [hydrated("alpha", "2026-11-01T00:00:00Z"), hydrated("gamma", "2026-10-29T00:00:00Z")] });
    expect(rows()).toEqual(["gamma", "alpha"]);
  });

  it("gives the fresh order on the next visit", async () => {
    await render({ ...home, session: null });
    await render({ ...home, session: null, local: [hydrated("alpha", "2026-11-01T00:00:00Z"), hydrated("gamma", "2026-10-29T00:00:00Z")] });
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await render({ ...home, session: null, local: [hydrated("alpha", "2026-11-01T00:00:00Z"), hydrated("gamma", "2026-10-29T00:00:00Z")] });
    expect(rows()).toEqual(["alpha", "gamma"]);
  });

  it("waits for the session even with a cached list, so nothing can be opened before it", async () => {
    cacheList();
    await render({ ...home, session: null, sessionRestoring: true });
    expect(holding()).toBe(true);
    await render(home);
    await listed(); await historyArrives();
    expect(holding()).toBe(false);
    expect(rows()).toEqual(finalOrder);
  });

  it("holds a Homepage whose user signs in, and shows the account's whole list together", async () => {
    await render({ ...home, session: null });
    expect(rows()).toEqual(["gamma", "alpha"]);

    await render(home);
    expect(holding()).toBe(true);
    expect(rows()).toEqual([]);
    await listed();
    expect(holding()).toBe(true);
    await historyArrives();
    expect(holding()).toBe(false);
    expect(rows()).toEqual(finalOrder);
  });

  it("stops holding that sign-in at the budget, so local projects stay reachable", async () => {
    vi.useFakeTimers();
    await render({ ...home, session: null });
    await render(home);
    expect(holding()).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(HOMEPAGE_FIRST_PAINT_BUDGET_MS - 1); });
    expect(holding()).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(holding()).toBe(false);
    expect(rows()).toEqual(["gamma", "alpha"]);
  });

  it("shows the whole cached list when a slow session outlasts the wait", async () => {
    vi.useFakeTimers();
    cacheList();
    await render({ ...home, session: null, sessionRestoring: true });
    expect(holding()).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(HOMEPAGE_FIRST_PAINT_BUDGET_MS); });
    expect(rows()).toEqual(finalOrder);

    await render(home);
    expect(holding()).toBe(false);
    expect(rows()).toEqual(finalOrder);
  });

  it("drops that list if the session turns out to be gone", async () => {
    vi.useFakeTimers();
    cacheList();
    await render({ ...home, session: null, sessionRestoring: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(HOMEPAGE_FIRST_PAINT_BUDGET_MS); });
    await render({ ...home, session: null });
    expect(rows()).toEqual(["gamma", "alpha"]);
    expect(localStorage.getItem(CATALOG_KEY)).toBeNull();
  });

  it("does not take back a Homepage released before a slow session turned up", async () => {
    vi.useFakeTimers();
    await render({ ...home, session: null, sessionRestoring: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(HOMEPAGE_FIRST_PAINT_BUDGET_MS); });
    expect(rows()).toEqual(["gamma", "alpha"]);
    await render(home);
    expect(holding()).toBe(false);
  });

  it("keeps the list through a new session generation of one account", async () => {
    await render(home); await listed(); await historyArrives();
    await render({ ...home, session: account("alice", "two") });
    expect(holding()).toBe(false);
    expect(rows()).toEqual(finalOrder);
  });

  it("holds again for another account, and never shows it the cached list", async () => {
    cacheList("bob");
    await render(home);
    expect(holding()).toBe(true);
    expect(rows()).toEqual([]);
  });

  it("forgets the names when the account signs out, not while its session restores", async () => {
    cacheList();
    await render({ ...home, session: null, sessionRestoring: true });
    expect(localStorage.getItem(CATALOG_KEY)).not.toBeNull();

    await render({ ...home, session: null });
    expect(localStorage.getItem(CATALOG_KEY)).toBeNull();
    expect(rows()).toEqual(["gamma", "alpha"]);
  });

  it("does not show a cached list offline, where it could only vanish again", async () => {
    cacheList();
    await render({ ...home, session: { ...alice, status: "offline-authenticated" } });
    expect(holding()).toBe(true);
    await act(async () => listing.reject(new Error("offline")));
    expect(holding()).toBe(false);
    expect(rows()).toEqual(["gamma", "alpha"]);
  });

  it("does not trust a cached list it cannot read", async () => {
    cacheList("alice", "not a list");
    await render(home);
    expect(holding()).toBe(true);
    localStorage.setItem(CATALOG_KEY, "{");
    await listed(); await historyArrives();
    expect(rows()).toEqual(finalOrder);
  });
});
