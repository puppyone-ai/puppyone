/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useCloudHistoryData,
  type CloudHistoryDataState,
} from "../../../../src/features/cloud/history/useCloudHistoryData";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import type {
  DesktopCloudHistory,
  DesktopCloudHistoryCommit,
} from "../../../../src/lib/cloudHistoryApi";

const getCloudHistory = vi.fn();
const onSessionChange = vi.fn();

vi.mock("../../../../src/lib/cloudHistoryApi", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/lib/cloudHistoryApi")>("../../../../src/lib/cloudHistoryApi");
  return { ...actual, getCloudHistory: (...args: unknown[]) => getCloudHistory(...args) };
});

const session: DesktopCloudSession = {
  expires_in: 3600,
  expires_at: 0,
  user_id: "user-1",
  user_email: "user@example.com",
  api_base_url: "https://cloud.example",
  session_generation: "generation-1",
  status: "authenticated",
};

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  getCloudHistory.mockReset();
  document.body.innerHTML = "";
});

describe("Cloud History data lifecycle", () => {
  it("single-flights rapid loadMore calls for the same cursor", async () => {
    const nextPage = deferred<DesktopCloudHistory>();
    const head = "a".repeat(40);
    const parent = "b".repeat(40);
    getCloudHistory
      .mockResolvedValueOnce(historyPage({
        commits: [historyCommit(head, [parent])],
        head_commit_id: head,
        refs: [{ ref_name: "refs/heads/main", ref_type: "branch", commit_id: head }],
        has_more: true,
        next_cursor: "h1.cursor",
        total: 2,
      }))
      .mockImplementationOnce(() => nextPage.promise);
    const state: { current: CloudHistoryDataState | null } = { current: null };
    render(<Probe onState={(value) => { state.current = value; }} />);
    await flush();

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    await act(async () => {
      first = state.current?.loadMore();
      second = state.current?.loadMore();
      await Promise.resolve();
    });
    expect(getCloudHistory).toHaveBeenCalledTimes(2);

    nextPage.resolve(historyPage({
      refs: [],
      refs_included: false,
      commits: [historyCommit(parent, [])],
      head_commit_id: head,
      total: 2,
    }));
    await act(async () => {
      await first;
      await second;
    });

    expect(state.current?.history?.commits.map((commit) => commit.commit_id)).toEqual([head, parent]);
  });

  it("refreshes atomically when a continuation page belongs to another snapshot", async () => {
    const firstHead = "c".repeat(40);
    const refreshedHead = "d".repeat(40);
    getCloudHistory
      .mockResolvedValueOnce(historyPage({
        snapshot_id: "1".repeat(64),
        commits: [historyCommit(firstHead, [])],
        head_commit_id: firstHead,
        has_more: true,
        next_cursor: "h1.old-snapshot",
        total: 2,
      }))
      .mockResolvedValueOnce(historyPage({
        snapshot_id: "2".repeat(64),
        commits: [historyCommit("e".repeat(40), [])],
        refs_included: false,
      }))
      .mockResolvedValueOnce(historyPage({
        snapshot_id: "2".repeat(64),
        commits: [historyCommit(refreshedHead, [])],
        head_commit_id: refreshedHead,
        refs: [{ ref_name: "refs/heads/main", ref_type: "branch", commit_id: refreshedHead }],
        total: 1,
      }));
    const state: { current: CloudHistoryDataState | null } = { current: null };
    render(<Probe onState={(value) => { state.current = value; }} />);
    await flush();

    await act(async () => {
      await state.current?.loadMore();
    });

    expect(getCloudHistory).toHaveBeenCalledTimes(3);
    expect(state.current?.history?.snapshot_id).toBe("2".repeat(64));
    expect(state.current?.history?.head_commit_id).toBe(refreshedHead);
    expect(state.current?.error).toBeNull();
  });

  it("refreshes instead of merging continuation metadata drift", async () => {
    const firstHead = "f".repeat(40);
    const refreshedHead = "a".repeat(40);
    getCloudHistory
      .mockResolvedValueOnce(historyPage({
        commits: [historyCommit(firstHead, [])],
        head_commit_id: firstHead,
        has_more: true,
        next_cursor: "h1.first",
        total: 2,
      }))
      .mockResolvedValueOnce(historyPage({
        commits: [historyCommit("b".repeat(40), [])],
        head_commit_id: "c".repeat(40),
        refs_included: false,
        total: 2,
      }))
      .mockResolvedValueOnce(historyPage({
        commits: [historyCommit(refreshedHead, [])],
        head_commit_id: refreshedHead,
        total: 1,
      }));
    const state: { current: CloudHistoryDataState | null } = { current: null };
    render(<Probe onState={(value) => { state.current = value; }} />);
    await flush();

    await act(async () => {
      await state.current?.loadMore();
    });

    expect(getCloudHistory).toHaveBeenCalledTimes(3);
    expect(state.current?.history?.head_commit_id).toBe(refreshedHead);
    expect(state.current?.error).toBeNull();
  });

  it("refreshes after the server reports an unavailable signed snapshot", async () => {
    const firstHead = "1".repeat(40);
    const refreshedHead = "2".repeat(40);
    const conflict = Object.assign(new Error("refresh the history snapshot"), { status: 409 });
    getCloudHistory
      .mockResolvedValueOnce(historyPage({
        commits: [historyCommit(firstHead, [])],
        head_commit_id: firstHead,
        has_more: true,
        next_cursor: "h1.expired",
        total: 2,
      }))
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(historyPage({
        snapshot_id: "3".repeat(64),
        commits: [historyCommit(refreshedHead, [])],
        head_commit_id: refreshedHead,
        total: 1,
      }));
    const state: { current: CloudHistoryDataState | null } = { current: null };
    render(<Probe onState={(value) => { state.current = value; }} />);
    await flush();

    await act(async () => {
      await state.current?.loadMore();
    });

    expect(getCloudHistory).toHaveBeenCalledTimes(3);
    expect(state.current?.history?.head_commit_id).toBe(refreshedHead);
    expect(state.current?.error).toBeNull();
  });

  it("does not reload when a parent passes an unstable session callback", async () => {
    getCloudHistory.mockResolvedValue(historyPage());
    render(<UnstableCallbackProbe />);

    await flush();
    await flush();

    expect(getCloudHistory).toHaveBeenCalledTimes(1);
  });
});

function Probe({ onState }: { onState: (state: CloudHistoryDataState) => void }) {
  const state = useCloudHistoryData({
    session,
    projectId: "proj-1",
    apiBaseUrl: "https://cloud.example",
    onSessionChange,
  });
  onState(state);
  return <div data-count={state.history?.commits.length ?? 0} />;
}

function UnstableCallbackProbe() {
  const state = useCloudHistoryData({
    session,
    projectId: "proj-1",
    apiBaseUrl: "https://cloud.example",
    onSessionChange: () => undefined,
  });
  return <div data-count={state.history?.commits.length ?? 0} />;
}

function historyPage(overrides: Partial<DesktopCloudHistory> = {}): DesktopCloudHistory {
  return {
    project_id: "proj-1",
    commits: [],
    topology_available: true,
    head_commit_id: null,
    refs: [],
    refs_included: true,
    snapshot_id: "1".repeat(64),
    next_cursor: null,
    has_more: false,
    total: 0,
    graph_health: "complete",
    unreadable_commit_ids: [],
    ...overrides,
  };
}

function historyCommit(commitId: string, parentIds: string[]): DesktopCloudHistoryCommit {
  return {
    commit_id: commitId,
    parent_ids: parentIds,
    who: "Cloud Author",
    message: "Commit",
    changes: [],
    conflicts: [],
    root_hash: "",
    scope_hash: "",
    scope_path: "",
    created_at: null,
    audit_detail: null,
  };
}

function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}
