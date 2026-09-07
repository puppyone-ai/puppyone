import { describe, expect, it, vi } from "vitest";
import { AgentReferenceDraftManager } from "../src/features/desktop-agent/application/AgentReferenceDraftManager";
import type { AgentControllerState } from "../src/features/desktop-agent/application/agent-controller-state";
import type { AgentClientPort } from "../src/features/desktop-agent/application/AgentClientPort";

function fixture(resolve: AgentClientPort["resolveAgentWorkspaceReferences"]) {
  let state = { references: [], inspection: { capabilities: { referenceInputs: { workspace: { files: true, directories: true, crossRoots: true }, limits: { maxCount: 32, maxBytesPerReference: 100, maxTotalBytes: 1000 } } } } } as unknown as AgentControllerState;
  const manager = new AgentReferenceDraftManager({ workspaceRoot: "/repo-a", bridgeProvider: () => ({ resolveAgentWorkspaceReferences: resolve }) as AgentClientPort, readState: () => state, patch: (patch) => { state = { ...state, ...patch }; }, appendText: vi.fn() });
  return { manager, readState: () => state };
}
const reference = { id: "b", kind: "workspace-entry" as const, entryType: "file" as const, relativePath: "docs/b.md", displayName: "b.md", status: "ready" as const, resourceUri: "puppyone-local://workspace/b/docs/b.md", workspaceName: "repo-b" };

describe("root-qualified reference drafts", () => {
  it("keeps valid entries when another source cannot be resolved and retries the original owner", async () => {
    const resolve = vi.fn().mockResolvedValueOnce([reference]).mockRejectedValueOnce(new Error("Missing source")).mockResolvedValueOnce([reference]);
    const f = fixture(resolve);
    const missing = "puppyone-local://workspace/missing/docs/%E4%B8%AD%E6%96%87.md";
    expect(await f.manager.addWorkspacePaths([reference.resourceUri, missing])).toBe(1);
    const failed = f.readState().references.find((entry) => entry.status === "error")!;
    expect(failed.displayName).toBe("中文.md");
    f.manager.retry(failed.id);
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(3));
    expect(resolve.mock.calls[2]![0]).toEqual({ rootPath: "/repo-a", paths: [missing] });
  });
  it("discards a late resolution after the draft was reset and releases its preview", async () => {
    let complete!: (value: typeof reference[]) => void;
    const f = fixture(() => new Promise((resolve) => { complete = resolve; }));
    const release = vi.fn();
    const isCurrent = f.manager.captureAcquisition();
    const pending = f.manager.addWorkspacePaths([reference.resourceUri], new Map([[reference.resourceUri, { url: "blob:preview", release }]]));
    await f.manager.reset([]);
    expect(isCurrent()).toBe(false);
    complete([reference]);
    expect(await pending).toBe(0);
    expect(f.readState().references).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
  });
});
