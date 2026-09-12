import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentAttachmentStoreLimits,
  createAgentAttachmentStore,
} from "../../../../electron/main/agent/agent-attachment-store.mjs";

const temporaryRoots = [];
afterEach(async () => Promise.all(temporaryRoots.splice(0).map((root) => (
  fs.promises.rm(root, { recursive: true, force: true })
))));

describe("Agent main-owned attachment staging", () => {
  it("revokes one Root's grants without touching sibling Root attachments", async () => {
    const root = await temporaryRoot();
    const source = path.join(root, "note.txt");
    await fs.promises.writeFile(source, "note");
    const store = createAgentAttachmentStore({ rootPath: path.join(root, "staging") });
    const [first] = await store.stage({
      ownerId: 7,
      workspaceRoot: "/workspace-a",
      epoch: "draft-a",
      sourcePaths: [source],
    });
    const [second] = await store.stage({
      ownerId: 7,
      workspaceRoot: "/workspace-b",
      epoch: "draft-b",
      sourcePaths: [source],
    });

    await store.revokeWorkspace(7, "/workspace-a");
    await expect(store.authorize({
      ownerId: 7,
      workspaceRoot: "/workspace-a",
      epoch: "draft-a",
      references: [first],
    })).rejects.toThrow(/invalid|expired/i);
    await expect(store.authorize({
      ownerId: 7,
      workspaceRoot: "/workspace-b",
      epoch: "draft-b",
      references: [second],
    })).resolves.toHaveLength(1);
    await store.close();
  });

  it("creates an immutable private snapshot and binds its opaque grant to owner, workspace and epoch", async () => {
    const root = await temporaryRoot();
    const workspace = await temporaryRoot();
    const source = path.join(root, "photo.png");
    const original = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("original")]);
    await fs.promises.writeFile(source, original);
    const store = createAgentAttachmentStore({ rootPath: path.join(root, "staging") });

    const [draft] = await store.stage({ ownerId: 7, workspaceRoot: workspace, epoch: "draft-a", sourcePaths: [source] });
    expect(draft).toMatchObject({ kind: "staged-attachment", displayName: "photo.png", mime: "image/png", status: "ready" });
    expect(draft.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(draft).not.toHaveProperty("path");
    expect(JSON.stringify(draft)).not.toContain(source);
    const [duplicate] = await store.stage({ ownerId: 7, workspaceRoot: workspace, epoch: "draft-a", sourcePaths: [source] });
    expect(duplicate).toEqual(draft);

    await fs.promises.writeFile(source, "changed after staging");
    await expect(store.authorize({ ownerId: 8, workspaceRoot: workspace, epoch: "draft-a", references: [draft] })).rejects.toThrow(/invalid|belongs/i);
    await expect(store.authorize({ ownerId: 7, workspaceRoot: `${workspace}-other`, epoch: "draft-a", references: [draft] })).rejects.toThrow(/invalid|belongs/i);
    await expect(store.authorize({ ownerId: 7, workspaceRoot: workspace, epoch: "draft-b", references: [draft] })).rejects.toThrow(/invalid|belongs/i);

    const [authorized] = await store.authorize({ ownerId: 7, workspaceRoot: workspace, epoch: "draft-a", references: [draft] });
    expect(authorized).not.toHaveProperty("snapshotUrl");
    expect(JSON.stringify(authorized)).not.toContain(original.toString("base64"));
    expect((await fs.promises.stat(authorized.path)).mode & 0o777).toBe(0o600);
    await store.close();
  });

  it("rejects symlinks, directories, oversized files and MIME-extension disagreement", async () => {
    const root = await temporaryRoot();
    const workspace = await temporaryRoot();
    const regular = path.join(root, "plain.txt");
    const link = path.join(root, "link.txt");
    const directory = path.join(root, "folder");
    const oversized = path.join(root, "oversized.bin");
    const fakeImage = path.join(root, "fake.png");
    await fs.promises.writeFile(regular, "text");
    await fs.promises.symlink(regular, link);
    await fs.promises.mkdir(directory);
    await fs.promises.writeFile(oversized, "x");
    await fs.promises.truncate(oversized, agentAttachmentStoreLimits.maxReferenceBytes + 1);
    await fs.promises.writeFile(fakeImage, "not a png");
    const store = createAgentAttachmentStore({ rootPath: path.join(root, "staging") });
    const stage = (sourcePath) => store.stage({ ownerId: 1, workspaceRoot: workspace, epoch: "draft", sourcePaths: [sourcePath] });

    await expect(stage(link)).rejects.toThrow(/non-symbolic-link/i);
    await expect(stage(directory)).rejects.toThrow(/regular/i);
    await expect(stage(oversized)).rejects.toThrow(/25 MB/i);
    await expect(stage(fakeImage)).resolves.toEqual([expect.objectContaining({ mime: "application/octet-stream" })]);
    await store.close();
  });

  it("preserves plain-text and SVG semantics for Harness-specific admission", async () => {
    const root = await temporaryRoot();
    const workspace = await temporaryRoot();
    const markdown = path.join(root, "README.md");
    const source = path.join(root, "app.ts");
    const svg = path.join(root, "logo.svg");
    await Promise.all([
      fs.promises.writeFile(markdown, "# Read me"),
      fs.promises.writeFile(source, "export const value = 1;"),
      fs.promises.writeFile(svg, "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"),
    ]);
    const store = createAgentAttachmentStore({ rootPath: path.join(root, "staging") });

    await expect(store.stage({
      ownerId: 9,
      workspaceRoot: workspace,
      epoch: "text-draft",
      sourcePaths: [markdown, source, svg],
    })).resolves.toEqual([
      expect.objectContaining({ displayName: "README.md", mime: "text/markdown" }),
      expect.objectContaining({ displayName: "app.ts", mime: "text/typescript" }),
      expect.objectContaining({ displayName: "logo.svg", mime: "image/svg+xml" }),
    ]);
    await store.close();
  });

  it("enforces aggregate count and byte budgets across separate staging calls", async () => {
    const root = await temporaryRoot();
    const workspace = await temporaryRoot();
    const sources = await Promise.all(Array.from({ length: agentAttachmentStoreLimits.maxReferences + 1 }, async (_, index) => {
      const source = path.join(root, `file-${index}.txt`);
      await fs.promises.writeFile(source, `value-${index}`);
      return source;
    }));
    const countStore = createAgentAttachmentStore({ rootPath: path.join(root, "count-staging") });
    await countStore.stage({
      ownerId: 2,
      workspaceRoot: workspace,
      epoch: "count-draft",
      sourcePaths: sources.slice(0, agentAttachmentStoreLimits.maxReferences),
    });
    await expect(countStore.stage({
      ownerId: 2,
      workspaceRoot: workspace,
      epoch: "count-draft",
      sourcePaths: [sources.at(-1)],
    })).rejects.toThrow(/32-file/i);

    const full = path.join(root, "full.bin");
    const extra = path.join(root, "extra.bin");
    await fs.promises.writeFile(full, "x");
    await fs.promises.truncate(full, agentAttachmentStoreLimits.maxTotalReferenceBytes);
    await fs.promises.writeFile(extra, "x");
    const byteStore = createAgentAttachmentStore({ rootPath: path.join(root, "byte-staging") });
    await byteStore.stage({ ownerId: 3, workspaceRoot: workspace, epoch: "byte-draft", sourcePaths: [full] });
    await expect(byteStore.stage({ ownerId: 3, workspaceRoot: workspace, epoch: "byte-draft", sourcePaths: [extra] }))
      .rejects.toThrow(/25 MB total/i);
    await Promise.all([countStore.close(), byteStore.close()]);
  });

  it("detects a source TOCTOU change and rolls a partial batch back transactionally", async () => {
    const root = await temporaryRoot();
    const workspace = await temporaryRoot();
    const source = path.join(root, "moving.txt");
    const invalid = path.join(root, "folder");
    await fs.promises.writeFile(source, "snapshot");
    await fs.promises.mkdir(invalid);
    const fsModule = changingStatFs(source);
    const store = createAgentAttachmentStore({ rootPath: path.join(root, "staging"), fsModule });
    await expect(store.stage({ ownerId: 1, workspaceRoot: workspace, epoch: "draft", sourcePaths: [source] }))
      .rejects.toThrow(/changed/i);

    const normalStore = createAgentAttachmentStore({ rootPath: path.join(root, "transactional") });
    await expect(normalStore.stage({ ownerId: 1, workspaceRoot: workspace, epoch: "draft", sourcePaths: [source, invalid] }))
      .rejects.toThrow(/regular/i);
    const processDirectories = await fs.promises.readdir(path.join(root, "transactional"));
    const files = await fs.promises.readdir(path.join(root, "transactional", processDirectories[0]));
    expect(files).toEqual([]);
    await Promise.all([store.close(), normalStore.close()]);
  });

  it("expires, revokes and sweeps snapshots without relying on renderer cleanup", async () => {
    const root = await temporaryRoot();
    const workspace = await temporaryRoot();
    const source = path.join(root, "note.txt");
    const staging = path.join(root, "staging");
    const orphan = path.join(staging, "old-process");
    await fs.promises.writeFile(source, "note");
    await fs.promises.mkdir(orphan, { recursive: true });
    await fs.promises.writeFile(path.join(orphan, "leak.snapshot"), "old");
    await fs.promises.utimes(orphan, new Date(0), new Date(0));
    let clock = agentAttachmentStoreLimits.defaultTtlMs + 1;
    const store = createAgentAttachmentStore({ rootPath: staging, now: () => clock });
    await store.initialize();
    await expect(fs.promises.stat(orphan)).rejects.toThrow();

    const [draft] = await store.stage({ ownerId: 3, workspaceRoot: workspace, epoch: "draft", sourcePaths: [source] });
    const [authorized] = await store.authorize({ ownerId: 3, workspaceRoot: workspace, epoch: "draft", references: [draft] });
    await store.revoke({ ownerId: 3, workspaceRoot: workspace, tokens: [draft.token] });
    await expect(fs.promises.stat(authorized.path)).rejects.toThrow();
    await expect(store.authorize({ ownerId: 3, workspaceRoot: workspace, epoch: "draft", references: [draft] })).rejects.toThrow(/invalid|expired/i);

    const [expiring] = await store.stage({ ownerId: 3, workspaceRoot: workspace, epoch: "draft", sourcePaths: [source] });
    clock += agentAttachmentStoreLimits.defaultTtlMs + 1;
    await expect(store.authorize({ ownerId: 3, workspaceRoot: workspace, epoch: "draft", references: [expiring] })).rejects.toThrow(/invalid|expired/i);

    const [leased] = await store.stage({ ownerId: 4, workspaceRoot: workspace, epoch: "leased-draft", sourcePaths: [source] });
    const [leasedInput] = await store.authorize({ ownerId: 4, workspaceRoot: workspace, epoch: "leased-draft", references: [leased] });
    await store.lease({
      ownerId: 4,
      workspaceRoot: workspace,
      epoch: "leased-draft",
      tokens: [leased.token],
      leaseId: "lease-test",
    });
    await expect(store.revoke({ ownerId: 4, workspaceRoot: workspace, tokens: [leased.token] }))
      .resolves.toEqual({ revoked: 0 });
    clock += agentAttachmentStoreLimits.defaultTtlMs + 1;
    await store.sweepExpired();
    await expect(fs.promises.stat(leasedInput.path)).resolves.toBeDefined();
    await store.releaseLease({ ownerId: 4, workspaceRoot: workspace, tokens: [leased.token], leaseId: "lease-test" });
    clock += agentAttachmentStoreLimits.defaultTtlMs + 1;
    await store.sweepExpired();
    await expect(fs.promises.stat(leasedInput.path)).rejects.toThrow();

    const [terminal] = await store.stage({ ownerId: 5, workspaceRoot: workspace, epoch: "terminal-draft", sourcePaths: [source] });
    const [terminalInput] = await store.authorize({ ownerId: 5, workspaceRoot: workspace, epoch: "terminal-draft", references: [terminal] });
    await store.lease({
      ownerId: 5,
      workspaceRoot: workspace,
      epoch: "terminal-draft",
      tokens: [terminal.token],
      leaseId: "terminal-lease",
    });
    await expect(store.revokeLeased({ ownerId: 5, workspaceRoot: workspace, tokens: [terminal.token] }))
      .resolves.toEqual({ revoked: 1 });
    await expect(fs.promises.stat(terminalInput.path)).rejects.toThrow();
    await store.close();
  });
});

function changingStatFs(sourcePath) {
  let sourceStatCalls = 0;
  return {
    constants: fs.constants,
    promises: new Proxy(fs.promises, {
      get(target, property) {
        if (property !== "open") return Reflect.get(target, property);
        return async (filename, flags, mode) => {
          const handle = await fs.promises.open(filename, flags, mode);
          if (filename !== sourcePath) return handle;
          return {
            read: (...args) => handle.read(...args),
            close: () => handle.close(),
            stat: async () => {
              const metadata = await handle.stat();
              sourceStatCalls += 1;
              return sourceStatCalls > 1 ? { ...metadata, size: metadata.size + 1 } : metadata;
            },
          };
        };
      },
    }),
  };
}

async function temporaryRoot() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-staging-"));
  temporaryRoots.push(root);
  return root;
}
