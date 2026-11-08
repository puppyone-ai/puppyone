import { describe, expect, it, vi } from "vitest";
import { AgentSessionController } from "../../../../src/features/desktop-agent/application/AgentSessionController";
import { bridgeFixture } from "../../../support/agent/agentSessionControllerFixture";

describe("AgentSessionController: references and attachments", () => {
  it("revokes staged grants on removal and keeps external paths outside renderer state", async () => {
    const bridge = bridgeFixture(() => {});
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    const file = new File(["png"], "capture.png", { type: "image/png" });
    await expect(controller.stageExternalFiles([file])).resolves.toBe(1);
    const [reference] = controller.getSnapshot().references;
    expect(reference).toMatchObject({ kind: "staged-attachment", displayName: "capture.png", status: "ready" });
    expect(reference).not.toHaveProperty("path");
    await expect(controller.stageExternalFiles([file])).resolves.toBe(0);
    expect(controller.getSnapshot().references).toHaveLength(1);
    controller.removeReference(reference.id);
    await vi.waitFor(() => expect(bridge.revokeAgentAttachments).toHaveBeenCalledWith({
      rootPath: "/workspace",
      tokens: ["stage-token"],
    }));
  });

  it("keeps image previews renderer-local and revokes their object URLs on removal", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:agent-image-preview");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const bridge = bridgeFixture(() => {});
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();

    await expect(controller.stageExternalFiles([
      new File(["png"], "capture.png", { type: "image/png" }),
    ])).resolves.toBe(1);
    const [reference] = controller.getSnapshot().references;
    expect(controller.getReferencePreviewUrl(reference.id)).toBe("blob:agent-image-preview");
    expect(reference).not.toHaveProperty("previewUrl");

    controller.removeReference(reference.id);
    expect(controller.getReferencePreviewUrl(reference.id)).toBeNull();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:agent-image-preview");
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
  });

  it("keeps valid entries from a partial external-file batch and exposes retryable errors for the rest", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.stageAgentAttachments
      .mockResolvedValueOnce([{
        id: "valid-image",
        kind: "staged-attachment",
        token: "valid-token",
        displayName: "valid.png",
        mime: "image/png",
        size: 3,
        status: "ready",
      }])
      .mockRejectedValueOnce(new Error("Only regular files can be attached."));
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();
    await expect(controller.stageExternalFiles([
      new File(["png"], "valid.png", { type: "image/png" }),
      new File(["bad"], "folder", { type: "application/octet-stream" }),
    ])).resolves.toBe(1);
    expect(controller.getSnapshot().references).toEqual([
      expect.objectContaining({ id: "valid-image", status: "ready" }),
      expect.objectContaining({ displayName: "folder", status: "error" }),
    ]);
  });

  it("removes Electron IPC transport boilerplate from reference diagnostics", async () => {
    const bridge = bridgeFixture(() => {});
    bridge.resolveAgentWorkspaceReferences.mockRejectedValueOnce(new Error(
      "Error invoking remote method 'agent:reference-resolve-workspace': Error: An Agent file reference no longer exists.",
    ));
    const controller = new AgentSessionController("/workspace", () => bridge as never);
    await controller.initialize();

    await expect(controller.addWorkspacePaths(["missing.md"])).resolves.toBe(0);
    expect(controller.getSnapshot().references).toEqual([
      expect.objectContaining({
        displayName: "missing.md",
        status: "error",
        error: {
          code: "workspace-resolution-failed",
          message: "An Agent file reference no longer exists.",
        },
      }),
    ]);
  });
});
