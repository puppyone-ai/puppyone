import fs from "node:fs/promises";
import { authorizeAgentReferences } from "../electron/main/agent/agent-reference-authorization.mjs";
import { agentReferenceMentionText } from "../shared/agent-contract/reference-identity.mjs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceResourceResolver } from "../electron/main/workspace-resource-resolver.mjs";
import { createSenderWorkspaceAuthorization } from "../electron/main/workspace-authorization.mjs";
import { registerAgentIpcHandlers } from "../electron/main/ipc/agent-ipc.mjs";
import { registerResourceTransferIpcHandlers } from "../electron/main/ipc/resource-transfer-ipc.mjs";
import { prepareAgentTurnReferenceInput } from "../electron/main/agent/application/agent-reference-policy.mjs";
import { createAcpWorkspaceFileSystem } from "../electron/main/agent/security/acp-workspace-files.mjs";
import { buildCodexTurnInput } from "../electron/main/agent/runtimes/codex/codex-reference-input.mjs";
import { buildClaudeUserMessageContent } from "../electron/main/agent/runtimes/claude/claude-prompt-input.mjs";
import { buildPiTurnInput } from "../electron/main/agent/runtimes/pi/pi-prompt-input.mjs";
import { buildAcpPromptBlocks } from "../electron/main/agent/protocols/acp/acp-prompt-input.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-resource-delivery-"));
  roots.push(temporary);
  const base = await fs.realpath(temporary);
  let folders = ["repo-a", "repo-b"].map((id) => ({ path: path.join(base, id), workspace: { id, workspaceInstanceId: id, name: id } }));
  for (const folder of folders) {
    await fs.mkdir(path.join(folder.path, "docs"), { recursive: true });
    await fs.writeFile(path.join(folder.path, "docs/README.md"), folder.workspace.name);
    await fs.writeFile(path.join(folder.path, "private.md"), "not referenced");
  }
  const event = { sender: { id: 7, isDestroyed: () => false, startDrag: vi.fn() } };
  const getFolders = (sender) => sender.id === 7 ? folders : [];
  const authorizeWorkspaceRoot = createSenderWorkspaceAuthorization({ getWorkspaceRootsForSender: (sender) => getFolders(sender).map((entry) => entry.path) });
  const resolveWorkspaceResource = createWorkspaceResourceResolver({ getFoldersForSender: getFolders, authorizeWorkspaceRoot });
  return { event, rootA: folders[0].path, rootB: folders[1].path, resolveWorkspaceResource, authorizeWorkspaceRoot, detachB: () => { folders = folders.slice(0, 1); } };
}

const uri = (root, relative = "docs/README.md") => `puppyone-local://workspace/${root}/${relative}`;

describe("resource delivery ownership", () => {
  it("resolves equal relative paths independently of the receiving root", async () => {
    const f = await fixture();
    const [a, b] = await Promise.all(["repo-a", "repo-b"].map((root) => f.resolveWorkspaceResource(f.event, uri(root), { legacyRoot: f.rootA })));
    expect(await fs.readFile(a.absolutePath, "utf8")).toBe("repo-a");
    expect(await fs.readFile(b.absolutePath, "utf8")).toBe("repo-b");
    expect(b).toMatchObject({ relativePath: "docs/README.md", workspaceRoot: f.rootB, folderId: "repo-b" });
    await expect(f.resolveWorkspaceResource(f.event, "docs/README.md")).rejects.toThrow(/attached/);
  });

  it("rejects unknown owners, other windows, traversal and symlink escape", async () => {
    const f = await fixture();
    for (const invalid of [uri("missing"), uri("repo-a", "../repo-b/private.md"), uri("repo-a", "%2e%2e/private.md"), uri("repo-a", "docs%2fREADME.md"), "file:///tmp/README.md"]) {
      await expect(f.resolveWorkspaceResource(f.event, invalid)).rejects.toThrow();
    }
    await expect(f.resolveWorkspaceResource({ sender: { id: 8 } }, uri("repo-a"))).rejects.toThrow(/attached/);
    await fs.symlink(path.join(f.rootB, "private.md"), path.join(f.rootA, "escape.md"));
    await expect(f.resolveWorkspaceResource(f.event, uri("repo-a", "escape.md"))).rejects.toThrow(/outside/);
  });

  it("keeps legacy draft mention IDs scoped to the original session root", async () => {
    const f = await fixture();
    const [old] = await authorizeAgentReferences({ workspaceRoot: f.rootA, references: ["docs/README.md"] });
    const [resolved] = await authorizeAgentReferences({ workspaceRoot: f.rootA, references: [{ kind: "workspace-entry", relativePath: old.relativePath, id: old.id, entryType: "file" }], resolveResource: (resource) => f.resolveWorkspaceResource(f.event, resource, { legacyRoot: f.rootA }) });
    expect(resolved.id).toBe(old.id);
    expect(resolved.path).toBe(old.path);
    expect(resolved.resourceUri).toBe(uri("repo-a"));
  });

  it("native export rechecks roots after asynchronous icon preparation", async () => {
    const f = await fixture();
    const handlers = new Map();
    registerResourceTransferIpcHandlers({
      ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
      resolveWorkspaceResource: f.resolveWorkspaceResource,
      getFileIcon: async () => { f.detachB(); return {}; },
    });
    await expect(handlers.get("resource-transfer:start-drag")(f.event, { resources: [uri("repo-b")] })).rejects.toThrow(/attached/);
    expect(f.event.sender.startDrag).not.toHaveBeenCalled();
  });

  it("exports multiple native files using authorized filesystem paths", async () => {
    const f = await fixture();
    const handlers = new Map();
    const icon = {};
    registerResourceTransferIpcHandlers({ ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, resolveWorkspaceResource: f.resolveWorkspaceResource, getFileIcon: async () => icon });
    await handlers.get("resource-transfer:start-drag")(f.event, { resources: [uri("repo-a"), uri("repo-b", "docs")] });
    expect(f.event.sender.startDrag).toHaveBeenCalledWith({ files: [path.join(f.rootA, "docs/README.md"), path.join(f.rootB, "docs")], icon });
  });

  it("refuses to bind an ambiguous legacy drag to the receiving terminal root", async () => {
    const f = await fixture();
    const handlers = new Map();
    registerResourceTransferIpcHandlers({ ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, resolveWorkspaceResource: f.resolveWorkspaceResource });
    const resolve = handlers.get("resource-transfer:resolve");
    const request = { resources: ["docs/README.md"], rootPath: f.rootA };
    await expect(resolve(f.event, request)).rejects.toThrow(/source project/);
    await expect(resolve(f.event, { ...request, sourceWorkspaceId: "repo-b" })).rejects.toThrow(/attached/);
    await expect(resolve(f.event, { ...request, sourceWorkspaceId: "repo-a" })).resolves.toMatchObject([{ absolutePath: path.join(f.rootA, "docs/README.md") }]);
  });

  it("round-trips cross-repo Agent identities through IPC and every native input adapter", async () => {
    const f = await fixture();
    const handlers = new Map();
    const startTurn = vi.fn(async () => ({ sessionId: "session-a", turnId: "turn-a" }));
    const capabilities = { workspace: { files: true, directories: true, crossRoots: true }, limits: { maxCount: 32, maxBytesPerReference: 25 * 1024 * 1024, maxTotalBytes: 25 * 1024 * 1024 } };
    registerAgentIpcHandlers({
      ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
      agentService: { startTurn, getReferenceInputCapabilities: () => capabilities },
      authorizeWorkspaceRoot: f.authorizeWorkspaceRoot,
      resolveWorkspaceResource: f.resolveWorkspaceResource,
    });
    const draft = await handlers.get("agent:reference-resolve-workspace")(f.event, { rootPath: f.rootA, paths: [uri("repo-a"), uri("repo-b")] });
    expect(draft[0].id).not.toBe(draft[1].id);
    expect(draft[1]).toMatchObject({ resourceUri: uri("repo-b"), workspaceName: "repo-b", relativePath: "docs/README.md" });
    expect(JSON.stringify(draft)).not.toContain(f.rootB);
    const prompt = `Review ${agentReferenceMentionText(draft[1])}`;
    const promptMentions = [{ referenceId: draft[1].id, start: 7, end: prompt.length }];
    const request = { rootPath: f.rootA, sessionId: "session-a", prompt, promptMentions, references: draft };
    await handlers.get("agent:turn-start")(f.event, request);
    const prepared = prepareAgentTurnReferenceInput({ prompt, promptMentions, references: startTurn.mock.calls[0][1].references }, { referenceInputs: capabilities });
    const nativeInputs = [
      buildCodexTurnInput(prepared.prompt, prepared.references, f.rootA),
      await buildClaudeUserMessageContent({ prompt: prepared.prompt, references: prepared.references, workspaceRoot: f.rootA }),
      await buildPiTurnInput({ prompt: prepared.prompt, references: prepared.references, workspaceRoot: f.rootA }),
      buildAcpPromptBlocks({ prompt: prepared.prompt, references: prepared.references, workspaceRoot: f.rootA }),
    ];
    for (const input of nativeInputs) {
      expect(JSON.stringify(input)).toContain(path.join(f.rootB, "docs/README.md"));
      expect(JSON.stringify(input)).not.toContain("puppyone-local://");
    }
    expect(prepared.referenceDisplays[1]).toMatchObject({ workspaceName: "repo-b" });
    let readReferences = prepared.references;
    const acpFiles = createAcpWorkspaceFileSystem({ workspaceRoot: f.rootA, getReadReferences: () => readReferences });
    await expect(acpFiles.readTextFile({ path: path.join(f.rootB, "docs/README.md") })).resolves.toEqual({ content: "repo-b" });
    await expect(acpFiles.readTextFile({ path: path.join(f.rootB, "private.md") })).rejects.toThrow(/authorized/);
    await expect(acpFiles.writeTextFile({ path: path.join(f.rootB, "docs/README.md"), content: "overwrite" })).rejects.toThrow(/authorized/);
    readReferences = [];
    await expect(acpFiles.readTextFile({ path: path.join(f.rootB, "docs/README.md") })).rejects.toThrow(/authorized/);
    f.detachB();
    await expect(handlers.get("agent:turn-start")(f.event, request)).rejects.toThrow(/attached/);
    expect(startTurn).toHaveBeenCalledOnce();
  });
});
