import { describe, expect, it, vi } from "vitest";
import { AgentReferenceDraftManager } from "../../../../src/features/desktop-agent/application/AgentReferenceDraftManager";
import { AgentOperationError } from "../../../../src/features/desktop-agent/application/agent-error";
import type { AgentControllerState } from "../../../../src/features/desktop-agent/application/agent-controller-state";
import type { AgentClientPort } from "../../../../src/features/desktop-agent/application/AgentClientPort";
import type { AgentDraftReference } from "../../../../src/features/desktop-agent/domain/agent-contract";

function fixture(resolve: AgentClientPort["resolveAgentWorkspaceReferences"], attachments: Partial<AgentClientPort> = {}) {
  let state = { references: [], inspection: { capabilities: { referenceInputs: { workspace: { files: true, directories: true, crossRoots: true }, attachments: { image: { accepted: true } }, limits: { maxCount: 32, maxBytesPerReference: 100, maxTotalBytes: 1000 } } } } } as unknown as AgentControllerState;
  const manager = new AgentReferenceDraftManager({ workspaceRoot: "/repo-a", bridgeProvider: () => ({ resolveAgentWorkspaceReferences: resolve, ...attachments }) as AgentClientPort, readState: () => state, patch: (patch) => { state = { ...state, ...patch }; }, appendText: vi.fn() });
  return { manager, readState: () => state };
}
const reference = { id: "b", kind: "workspace-entry" as const, entryType: "file" as const, relativePath: "docs/b.md", displayName: "b.md", status: "ready" as const, resourceUri: "puppyone-local://workspace/b/docs/b.md", workspaceName: "repo-b" };

describe("root-qualified reference drafts", () => {
  it.each(["attachment", "workspace"])("preserves the structured failure reason for a %s reference", async (kind) => {
    const error = new AgentOperationError({ schemaVersion: 1, code: "PROJECT_CLOSING", message: "This project is closing.", stage: "authorization", retryable: true, actions: [] });
    const fail = async () => { throw error; };
    const f = fixture(fail, { stageAgentAttachments: fail });
    if (kind === "attachment") await f.manager.stageExternalFiles([new File(["image"], "image.png", { type: "image/png" })]);
    else await f.manager.addWorkspacePaths(["image.png"]);
    expect(f.readState().references[0]?.error).toEqual({ code: "PROJECT_CLOSING", message: "This project is closing.", stage: "authorization", retryable: true });
  });

  it("keeps legacy failures bounded without inventing retry policy", async () => {
    const f = fixture(async () => [], { stageAgentAttachments: async () => { throw new Error("read failed\n".repeat(100)); } });
    await f.manager.stageExternalFiles([new File(["image"], "image.png", { type: "image/png" })]);
    const error = f.readState().references[0]!.error!;
    expect(error.code).toBe("staging-failed");
    expect(error.message.length).toBeLessThanOrEqual(500);
    expect(error.message).not.toContain("\n");
    expect(error).not.toHaveProperty("retryable");
  });

  it.each(["remove", "reset", "dispose"])("does not resurrect an image when %s happens during staging", async (action) => {
    let complete!: (value: AgentDraftReference[]) => void;
    const revoke = vi.fn(async () => ({ revoked: 1 }));
    const f = fixture(async () => [], {
      stageAgentAttachments: () => new Promise((resolve) => { complete = resolve; }),
      revokeAgentAttachments: revoke,
    });
    const pending = f.manager.stageExternalFiles([new File(["image"], "image.png", { type: "image/png" })]);
    const pendingReference = f.readState().references[0]!;
    if (action === "remove") f.manager.remove(pendingReference.id);
    else if (action === "reset") await f.manager.reset(f.readState().references);
    else f.manager.disposeRendererResources();
    complete([{ id: "staged-image", kind: "staged-attachment", token: "image-token", displayName: "image.png", mime: "image/png", size: 5, status: "ready" }]);
    expect(await pending).toBe(0);
    expect(f.readState().references.some((entry) => entry.id === "staged-image")).toBe(false);
    expect(revoke).toHaveBeenCalledWith({ rootPath: "/repo-a", tokens: ["image-token"] });
  });

  it("publishes each completed image without removing its pending sibling", async () => {
    const finish: Array<(value: AgentDraftReference[]) => void> = [];
    const f = fixture(async () => [], {
      stageAgentAttachments: () => new Promise((resolve) => { finish.push(resolve); }),
    });
    const pending = f.manager.stageExternalFiles([
      new File(["first"], "first.png", { type: "image/png" }),
      new File(["second"], "second.png", { type: "image/png" }),
    ]);
    finish[0]!([{ id: "first", kind: "staged-attachment", token: "first-token", displayName: "first.png", mime: "image/png", size: 5, status: "ready" }]);
    await vi.waitFor(() => expect(f.readState().references.map((entry) => entry.status).sort()).toEqual(["ready", "resolving"]));
    finish[1]!([{ id: "second", kind: "staged-attachment", token: "second-token", displayName: "second.png", mime: "image/png", size: 6, status: "ready" }]);
    expect(await pending).toBe(2);
    expect(f.readState().references.map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("does not revoke the retained token when a cancelled acquisition deduplicates to it", async () => {
    let complete!: (value: AgentDraftReference[]) => void;
    const image: AgentDraftReference = { id: "image", kind: "staged-attachment", token: "image-token", displayName: "image.png", mime: "image/png", size: 5, status: "ready" };
    const revoke = vi.fn(async () => ({ revoked: 1 }));
    const f = fixture(async () => [], {
      stageAgentAttachments: vi.fn().mockResolvedValueOnce([image]).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; })),
      revokeAgentAttachments: revoke,
    });
    const file = new File(["image"], "image.png", { type: "image/png" });
    expect(await f.manager.stageExternalFiles([file])).toBe(1);
    const pending = f.manager.stageExternalFiles([file]);
    f.manager.remove(f.readState().references.find((entry) => entry.status === "resolving")!.id);
    complete([image]);
    expect(await pending).toBe(0);
    expect(f.readState().references).toEqual([image]);
    expect(revoke).not.toHaveBeenCalled();
  });

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
