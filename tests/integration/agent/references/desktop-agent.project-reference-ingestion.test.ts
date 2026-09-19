import { File as NodeFile } from "node:buffer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectSessionService } from "../../../../electron/main/workspace/project-sessions/project-session-service.mjs";
import { registerAgentIpcHandlers } from "../../../../electron/main/ipc/agent-ipc.mjs";
import { createAgentAttachmentStore } from "../../../../electron/main/agent/agent-attachment-store.mjs";
import { AgentReferenceDraftManager } from "../../../../src/features/desktop-agent/application/AgentReferenceDraftManager";
import { AgentTurnSubmissionCoordinator } from "../../../../src/features/desktop-agent/application/AgentTurnSubmissionCoordinator";
import { createProjectAgentClientProvider } from "../../../../src/features/desktop-agent/infrastructure/electron/electronAgentClient";
import type { AgentControllerState } from "../../../../src/features/desktop-agent/application/agent-controller-state";
import type { AgentReferenceInputCapabilities } from "../../../../shared/agent-contract/types";
import type { ProjectSessionContext } from "../../../../shared/project-session-contract/types";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4AWP8DwQMQMDEAAUAPfgEADYYS7QAAAAASUVORK5CYII=", "base64");
const referenceInputs: AgentReferenceInputCapabilities = {
  schemaVersion: 1, workspace: { files: true, directories: true },
  attachments: { image: { accepted: true, mimeTypes: ["image/png"] }, text: { accepted: false }, audio: { accepted: false }, video: { accepted: false }, binary: { accepted: false } },
  limits: { maxCount: 32, maxBytesPerReference: 25 * 1024 * 1024, maxTotalBytes: 25 * 1024 * 1024 },
  attachmentOnly: false, steer: false,
};
const disposals: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0).reverse()) await dispose();
  vi.unstubAllGlobals();
});

describe("project-scoped production attachment chain", () => {
  it.each(["native", "pathless"] as const)("stages and submits a %s image through the project client, preload and Main", async (route) => {
    const h = await harness(route);
    const pending = h.manager.stageExternalFiles([h.file]);
    expect(h.state().references[0]?.status).toBe("resolving");
    expect(h.manager.previewUrl(h.state().references[0]!.id)).toBeTruthy();
    expect(await pending).toBe(1);
    const [draft] = h.state().references;
    expect(draft).toMatchObject({ kind: "staged-attachment", status: "ready", mime: "image/png" });
    expect(h.stage).toHaveBeenCalledOnce();
    expect(h.stageRequest()?.projectContext).toEqual(h.context);
    expect(await h.submission.submit("Describe this image")).toBe(true);
    expect(h.startTurn).toHaveBeenCalledOnce();
    expect(h.deliveredBytes()).toEqual(png);
    expect(h.startTurn.mock.calls[0]![1]).toHaveProperty("privateReferenceLease.tokens");
  });

  it.each(["missing", "stale", "other-window", "wrong-root", "closed"] as const)("retains a structured %s project failure and never dispatches the draft", async (failure) => {
    const h = await harness("pathless", failure);
    expect(await h.manager.stageExternalFiles([h.file])).toBe(0);
    const [draft] = h.state().references;
    const code = failure === "missing" ? "PROJECT_CONTEXT_REQUIRED" : failure === "wrong-root" ? "PROJECT_UNAUTHORIZED" : "PROJECT_STALE";
    expect(draft).toMatchObject({ status: "error", error: { code, retryable: false } });
    expect(h.manager.previewUrl(draft!.id)).toBeTruthy();
    expect(h.stage).not.toHaveBeenCalled();
    expect(await h.submission.submit("Describe this image")).toBe(false);
    expect(h.state().error?.code).toBe("references-not-ready");
    expect(h.startTurn).not.toHaveBeenCalled();
  });

  it("does not acquire a new project generation when a pathless read finishes after close/reopen", async () => {
    const h = await harness("pathless");
    let complete!: (buffer: ArrayBuffer) => void;
    vi.spyOn(h.file, "arrayBuffer").mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = h.manager.stageExternalFiles([h.file]);
    await h.projects.close(h.ownerId, h.context);
    h.projects.open(h.ownerId, h.folder);
    complete(Uint8Array.from(png).buffer);
    expect(await pending).toBe(0);
    expect(h.state().references[0]).toMatchObject({ error: { code: "PROJECT_STALE" } });
    expect(h.stage).not.toHaveBeenCalled();
  });

  it("releases a late staged grant after its pending image was removed", async () => {
    const h = await harness("pathless");
    const original = h.stage.getMockImplementation()!;
    let complete!: () => void;
    let staged!: () => void;
    const reachedStore = new Promise<void>((resolve) => { staged = resolve; });
    h.stage.mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      staged();
      await new Promise<void>((resolve) => { complete = resolve; });
      return result;
    });
    const pending = h.manager.stageExternalFiles([h.file]);
    // Fail promptly if ingress regresses instead of hiding it behind a timeout.
    await Promise.race([reachedStore, pending.then(() => { throw new Error("Attachment did not reach the store"); })]);
    h.manager.remove(h.state().references[0]!.id);
    complete();
    expect(await pending).toBe(0);
    expect(h.state().references).toEqual([]);
    const [draft] = await h.stage.mock.results[0]!.value;
    await expect(h.store.authorize({ ownerId: h.ownerId, workspaceRoot: h.context.rootPath, epoch: h.manager.referenceEpoch, references: [draft] })).rejects.toThrow(/invalid|expired/i);
  });
});

async function harness(route: "native" | "pathless", failure?: "missing" | "stale" | "other-window" | "wrong-root" | "closed") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-project-attachment-"));
  disposals.push(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const sourcePath = path.join(root, "image.png");
  await fs.writeFile(sourcePath, png);
  const ownerId = 71;
  const folder = { path: workspace, workspace: { id: "attachment-project" } };
  const projects = createProjectSessionService();
  const record = projects.open(ownerId, folder);
  const context: ProjectSessionContext = { projectId: record.projectId, rootPath: record.rootPath, generation: record.generation };
  const store = createAgentAttachmentStore({ rootPath: path.join(root, "staging") });
  disposals.push(() => store.close());
  const stage = vi.fn(store.stage);
  let delivered: Buffer | null = null;
  const startTurn = vi.fn(async (_sender: unknown, request: { references: Array<{ path: string }> }) => {
    delivered = await fs.readFile(request.references[0]!.path);
    return { sessionId: "attachment-session", turnId: "attachment-turn" };
  });
  type Request = Record<string, unknown>;
  type Handler = (event: { sender: { id: number } }, request: Request) => Promise<unknown>;
  const handlers = new Map<string, Handler>();
  registerAgentIpcHandlers({ ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    projectSessions: projects, attachmentStore: { ...store, stage },
    agentService: { assertSessionInstance() {}, getReferenceInputCapabilities: () => referenceInputs, startTurn },
    localAgentInventory: {}, resolveWorkspaceResource: undefined, dialog: undefined, getDialogOwnerWindow: undefined,
    authorizeWorkspaceRoot: async () => { throw new Error("Project authority must not use the compatibility fallback"); },
  });
  let bridge!: NonNullable<Window["puppyoneDesktop"]>;
  let stageRequest: Request | undefined;
  const source = await fs.readFile(new URL("../../../../electron/preload.cjs", import.meta.url), "utf8");
  vm.runInNewContext(source, { process: { argv: [] }, Uint8Array, require: () => ({
    contextBridge: { exposeInMainWorld: (_name: string, value: typeof bridge) => { bridge = value; } },
    webUtils: { getPathForFile: () => route === "native" ? sourcePath : "" },
    ipcRenderer: { on() {}, send() {}, removeListener() {}, invoke: (channel: string, request: Request) => {
      if (channel === "agent:reference-stage") {
        stageRequest = request;
        if (failure === "missing") request = { ...request, projectContext: undefined };
      }
      return handlers.get(channel)!({ sender: { id: failure === "other-window" ? ownerId + 1 : ownerId } }, request);
    } },
  }) }, { filename: "production-preload.cjs" });
  vi.stubGlobal("window", { puppyoneDesktop: bridge });
  const boundContext = failure === "stale" ? { ...context, generation: "obsolete" }
    : failure === "wrong-root" ? { ...context, rootPath: path.join(root, "another-project") } : context;
  // A valid context pointing to another owned project must not authorize this root.
  if (failure === "wrong-root") {
    const other = projects.open(ownerId, { path: boundContext.rootPath, workspace: { id: "other-project" } });
    Object.assign(boundContext, { generation: other.generation, projectId: other.projectId });
  }
  if (failure === "closed") await projects.close(ownerId, context);
  const provider = createProjectAgentClientProvider(boundContext);
  let state = { references: [], draft: "Describe this image", draftMentions: [], inspection: { capabilities: { referenceInputs } },
    submitting: false, pendingIntent: null, projection: { runningTurnId: null }, session: { id: "attachment-session" },
  } as unknown as AgentControllerState;
  const patch = (value: Partial<AgentControllerState>) => { state = { ...state, ...value }; };
  const manager = new AgentReferenceDraftManager({ workspaceRoot: workspace, bridgeProvider: provider, readState: () => state, patch, appendText() {} });
  disposals.push(async () => { manager.disposeRendererResources(); });
  const submission = new AgentTurnSubmissionCoordinator({ workspaceRoot: workspace, bridgeProvider: provider, references: manager, readState: () => state, patch, writeDraft() {}, prepareSession: async () => false });
  const file = new NodeFile([png], "image.png", { type: "image/png" }) as unknown as File;
  return { context, manager, submission, file, stage, store, startTurn, projects, ownerId, folder, state: () => state, stageRequest: () => stageRequest, deliveredBytes: () => delivered };
}
