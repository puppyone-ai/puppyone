/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceHistorySidebar } from "../../../../src/features/cloud/history/CloudWorkspaceHistorySidebar";
import { getCloudHistory, type DesktopCloudHistory } from "../../../../src/lib/cloudHistoryApi";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudHistoryApi", () => ({ getCloudHistory: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const apiBaseUrl = "https://cloud-fixture.puppyone.ai/api/v1";
const session: DesktopCloudSession = { api_base_url: apiBaseUrl, user_id: "one", user_email: "one@example.com",
  session_generation: "one", status: "authenticated", expires_at: Date.now() + 3600000, expires_in: 3600 };
const head = "a".repeat(40), parent = "b".repeat(40);
const page = (older = false): DesktopCloudHistory => ({ project_id: "project", topology_available: true,
  head_commit_id: head, refs: older ? [] : [{ ref_name: "refs/heads/main", ref_type: "branch", commit_id: head }],
  refs_included: !older, snapshot_id: "c".repeat(64), next_cursor: older ? null : "h1.cursor", has_more: !older,
  graph_health: "complete", unreadable_commit_ids: [], total: 2,
  commits: [{ commit_id: older ? parent : head, parent_ids: older ? [] : [parent], who: "Researcher",
    message: older ? "Create notes" : "Update notes", created_at: "2026-10-10T06:00:00Z",
    changes: [{ path: "notes.md", action: older ? "add" : "update" }], conflicts: [],
    root_hash: "d".repeat(40), scope_hash: "d".repeat(40), scope_path: "", audit_detail: null }] });
let root: Root | null = null;
const close = vi.fn();
async function render(props: Partial<Parameters<typeof CloudWorkspaceHistorySidebar>[0]> = {}) {
  if (!root) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  await act(async () => root!.render(withTestLocalization(<CloudWorkspaceHistorySidebar session={session}
    projectId="project" apiBaseUrl={apiBaseUrl} active revisionKey="0" onSessionChange={vi.fn()} onClose={close} {...props} />)));
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find(item => item.textContent?.includes(text) || item.getAttribute("aria-label") === text)!;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.resetAllMocks(); });

describe("Cloud History in the workspace sidebar", () => {
  it("only fetches when visible; selecting a commit and returning use the same response", async () => {
    vi.mocked(getCloudHistory).mockResolvedValue(page());
    await render({ active: false }); expect(getCloudHistory).not.toHaveBeenCalled();
    await render(); expect(getCloudHistory).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".desktop-git-history-sidebar")).not.toBeNull();
    expect(document.querySelector(".desktop-commit-detail")).toBeNull();
    act(() => button("Update notes").click());
    expect(document.querySelector(".desktop-commit-detail")?.textContent).toContain("notes.md");
    expect(document.body.textContent).toContain("HEAD");
    expect(getCloudHistory).toHaveBeenCalledTimes(1);
    act(() => button("Back").click());
    expect(document.querySelector(".desktop-commit-detail")).toBeNull(); expect(close).not.toHaveBeenCalled();
    act(() => button("Close").click()); expect(close).toHaveBeenCalledTimes(1);
  });
  it("appends a cursor page once even on a rapid double click", async () => {
    let finish!: (data: DesktopCloudHistory) => void;
    vi.mocked(getCloudHistory).mockResolvedValueOnce(page()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render(); act(() => { button("Load more").click(); button("Load more").click(); });
    expect(getCloudHistory).toHaveBeenCalledTimes(2);
    expect(vi.mocked(getCloudHistory).mock.calls[1]?.[5]).toBe("h1.cursor");
    await act(async () => finish(page(true)));
    expect(document.body.textContent).toContain("Create notes"); expect(button("Load more")).toBeUndefined();
  });
  it("offers recovery after a failed initial request and refreshes after publication", async () => {
    vi.mocked(getCloudHistory).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(page());
    await render(); expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => button("Try again").click());
    expect(document.querySelector('[role="alert"]')).toBeNull(); expect(getCloudHistory).toHaveBeenCalledTimes(2);
    await render({ revisionKey: "1" }); expect(getCloudHistory).toHaveBeenCalledTimes(3);
    await render({ revisionKey: "1" }); expect(getCloudHistory).toHaveBeenCalledTimes(3);
  });
});
