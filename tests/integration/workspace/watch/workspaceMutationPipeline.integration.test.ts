import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkbenchWorkspace,
  createWorkspaceResourceUri,
  workspaceContentChangeMatchesResource,
  type WorkbenchWorkspace,
  type Workspace,
  type WorkspaceContentChange,
} from "@puppyone/shared-ui";
import {
  WORKSPACE_WATCH_MAX_PENDING_PATHS,
  createWorkspaceWatchService,
} from "../../../../electron/main/workspace-watch-service.mjs";
import { appendWorkbenchWorkspaceContentChange } from "../../../../src/features/data-workspace/workbenchWorkspaceContentChange";

const MUTATION_SOURCES = [
  "frontend editor save observed by another window",
  "plain shell command in Terminal",
  "Codex or Cursor CLI hosted in Terminal",
  "Native Agent Chat in the right sidebar",
  "external desktop editor",
] as const;

describe("P0 source-neutral Workspace mutation pipeline", () => {
  const activeHarnesses: MutationPipelineHarness[] = [];

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const harness of activeHarnesses.splice(0)) harness.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(MUTATION_SOURCES)("%s reaches the same canonical open-resource invalidation", async () => {
    const harness = createHarness(activeHarnesses, [workspace("alpha", "/tmp/customer-alpha")]);
    const folder = harness.workbench.folders[0]!;
    const openResource = createWorkspaceResourceUri(folder.uri, "src/customer.md");

    harness.emit(folder.id, "change", "src/customer.md");
    await harness.flush();

    expect(harness.journal().sequence).toBe(1);
    expect(harness.journal().entries[0]).toMatchObject({
      rootUri: folder.uri,
      paths: ["src/customer.md"],
    });
    expect(workspaceContentChangeMatchesResource(harness.journal(), openResource, 0)).toBe(true);
  });

  it.each([
    { customerAction: "creates a new file", eventType: "rename" },
    { customerAction: "overwrites an existing file", eventType: "change" },
    { customerAction: "deletes an open file", eventType: "rename" },
    { customerAction: "moves a file into a watched folder", eventType: "rename" },
  ])("$customerAction remains observable through native $eventType events", async ({ eventType }) => {
    const harness = createHarness(activeHarnesses, [workspace("alpha", "/tmp/customer-file-lifecycle")]);
    const folder = harness.workbench.folders[0]!;
    harness.emit(folder.id, eventType, "docs/lifecycle.md");
    await harness.flush();

    expect(workspaceContentChangeMatchesResource(
      harness.journal(),
      createWorkspaceResourceUri(folder.uri, "docs/lifecycle.md"),
      0,
    )).toBe(true);
  });

  it("coalesces a large multi-file edit into one lossless, deduplicated batch", async () => {
    const harness = createHarness(activeHarnesses, [workspace("alpha", "/tmp/customer-batch")]);
    const folder = harness.workbench.folders[0]!;
    const paths = Array.from({ length: 200 }, (_, index) => `generated/file-${index}.ts`);
    for (const path of paths) harness.emit(folder.id, "change", path);
    harness.emit(folder.id, "rename", paths[0]!);
    harness.emit(folder.id, "change", paths[0]!);

    await harness.flush();

    expect(harness.journal().entries).toHaveLength(1);
    expect(harness.journal().entries[0]?.paths).toEqual(paths);
    for (const path of [paths[0]!, paths[99]!, paths[199]!]) {
      expect(workspaceContentChangeMatchesResource(
        harness.journal(),
        createWorkspaceResourceUri(folder.uri, path),
        0,
      )).toBe(true);
    }
  });

  it("degrades an extreme generated-file storm to a bounded scoped refresh without losing correctness", async () => {
    const harness = createHarness(activeHarnesses, [workspace("alpha", "/tmp/customer-extreme-batch")]);
    const folder = harness.workbench.folders[0]!;
    for (let index = 0; index <= WORKSPACE_WATCH_MAX_PENDING_PATHS; index += 1) {
      harness.emit(folder.id, "change", `generated/file-${index}.ts`);
    }
    await harness.flush();

    expect(harness.journal().entries).toHaveLength(1);
    expect(harness.journal().entries[0]).toMatchObject({ rootUri: folder.uri, paths: null });
    expect(workspaceContentChangeMatchesResource(
      harness.journal(),
      createWorkspaceResourceUri(folder.uri, "any-open-file.md"),
      0,
    )).toBe(true);
  });

  it("preserves simultaneous same-name edits from multiple Workspace Folders", async () => {
    const harness = createHarness(activeHarnesses, [
      workspace("alpha", "/tmp/customer-multi-alpha"),
      workspace("beta", "/tmp/customer-multi-beta"),
      workspace("gamma", "/tmp/customer-multi-gamma"),
    ]);
    const [alpha, beta, gamma] = harness.workbench.folders;
    harness.emit(alpha!.id, "change", "README.md");
    harness.emit(beta!.id, "change", "README.md");

    await harness.flush();

    expect(harness.journal().entries).toHaveLength(2);
    expect(workspaceContentChangeMatchesResource(
      harness.journal(),
      createWorkspaceResourceUri(alpha!.uri, "README.md"),
      0,
    )).toBe(true);
    expect(workspaceContentChangeMatchesResource(
      harness.journal(),
      createWorkspaceResourceUri(beta!.uri, "README.md"),
      0,
    )).toBe(true);
    expect(workspaceContentChangeMatchesResource(
      harness.journal(),
      createWorkspaceResourceUri(gamma!.uri, "README.md"),
      0,
    )).toBe(false);
  });

  it("keeps an unknown native path bulk refresh scoped to only its originating root", async () => {
    const harness = createHarness(activeHarnesses, [
      workspace("alpha", "/tmp/customer-unknown-alpha"),
      workspace("beta", "/tmp/customer-unknown-beta"),
    ]);
    const [alpha, beta] = harness.workbench.folders;
    harness.emit(alpha!.id, "change", null);
    await harness.flush();

    expect(harness.journal().entries[0]).toMatchObject({ rootUri: alpha!.uri, paths: null });
    expect(workspaceContentChangeMatchesResource(
      harness.journal(),
      createWorkspaceResourceUri(alpha!.uri, "any/open/file.md"),
      0,
    )).toBe(true);
    expect(workspaceContentChangeMatchesResource(
      harness.journal(),
      createWorkspaceResourceUri(beta!.uri, "any/open/file.md"),
      0,
    )).toBe(false);
  });

  it("treats a known path plus an unknown path as a scoped bulk refresh", async () => {
    const harness = createHarness(activeHarnesses, [workspace("alpha", "/tmp/customer-mixed")]);
    const folder = harness.workbench.folders[0]!;
    harness.emit(folder.id, "change", "known.md");
    harness.emit(folder.id, "change", null);
    await harness.flush();

    expect(harness.journal().entries[0]).toMatchObject({ rootUri: folder.uri, paths: null });
    expect(workspaceContentChangeMatchesResource(
      harness.journal(),
      createWorkspaceResourceUri(folder.uri, "not-enumerated.md"),
      0,
    )).toBe(true);
  });

  it("deduplicates atomic-save rename/change bursts and ignores PuppyOne temp files", async () => {
    const harness = createHarness(activeHarnesses, [workspace("alpha", "/tmp/customer-atomic")]);
    const folder = harness.workbench.folders[0]!;
    harness.emit(folder.id, "rename", ".note.md.puppyone-123-a1b2.tmp");
    harness.emit(folder.id, "rename", "note.md");
    harness.emit(folder.id, "change", "note.md");
    harness.emit(folder.id, "rename", "note.md");
    await harness.flush();

    expect(harness.journal().entries).toHaveLength(1);
    expect(harness.journal().entries[0]?.paths).toEqual(["note.md"]);
  });

  it("suppresses an in-app save echo only for its writer while every other window refreshes", async () => {
    const harness = createHarness(
      activeHarnesses,
      [workspace("alpha", "/tmp/customer-own-write")],
      [11, 12],
    );
    const folder = harness.workbench.folders[0]!;
    harness.service.noteInternalWrite({
      rootPath: folder.workspace.path,
      path: "note.md",
      senderId: 11,
      version: fingerprint("after"),
    });
    harness.emit(folder.id, "rename", "note.md");
    await harness.flush();

    expect(harness.journal(11).sequence).toBe(0);
    expect(harness.journal(12).sequence).toBe(1);
    expect(workspaceContentChangeMatchesResource(
      harness.journal(12),
      createWorkspaceResourceUri(folder.uri, "note.md"),
      0,
    )).toBe(true);
  });

  it("does not suppress a newer Terminal or Agent write to a path after an in-app save", async () => {
    const harness = createHarness(
      activeHarnesses,
      [workspace("alpha", "/tmp/customer-newer-write")],
      [21],
    );
    const folder = harness.workbench.folders[0]!;
    harness.service.noteInternalWrite({
      rootPath: folder.workspace.path,
      path: "note.md",
      senderId: 21,
      version: fingerprint("old-version"),
    });
    harness.emit(folder.id, "change", "note.md");
    await harness.flush();

    expect(harness.journal(21).sequence).toBe(1);
    expect(workspaceContentChangeMatchesResource(
      harness.journal(21),
      createWorkspaceResourceUri(folder.uri, "note.md"),
      0,
    )).toBe(true);
  });
});

type FakeWatcher = EventEmitter & {
  close: ReturnType<typeof vi.fn>;
  listener: (eventType: string, filename: string | null) => void;
};

type MutationPipelineHarness = Readonly<{
  workbench: WorkbenchWorkspace;
  service: ReturnType<typeof createWorkspaceWatchService>;
  emit: (folderId: string, eventType: string, path: string | null) => void;
  flush: () => Promise<void>;
  journal: (senderId?: number) => WorkspaceContentChange;
  dispose: () => void;
}>;

function createHarness(
  activeHarnesses: MutationPipelineHarness[],
  workspaces: readonly Workspace[],
  senderIds: readonly number[] = [1],
): MutationPipelineHarness {
  const workbench = createWorkbenchWorkspace(workspaces);
  const watchers = new Map<string, FakeWatcher>();
  const fsModule = {
    promises: {
      readFile: vi.fn(async () => Buffer.from("after")),
    },
    watch(rootPath: string, _options: unknown, listener: FakeWatcher["listener"]) {
      const watcher = new EventEmitter() as FakeWatcher;
      watcher.close = vi.fn();
      watcher.listener = listener;
      watchers.set(rootPath, watcher);
      return watcher;
    },
  };
  const service = createWorkspaceWatchService({
    fsModule,
    logger: { info: () => {}, warn: () => {} },
  });
  const journals = new Map(senderIds.map((senderId) => [senderId, emptyJournal()]));

  for (const senderId of senderIds) {
    for (const folder of workbench.folders) {
      service.start({
        id: senderId,
        isDestroyed: () => false,
        once: () => {},
        send(channel: string, payload: { path: string | null; paths?: string[] }) {
          if (channel !== "workspace:changed") return;
          journals.set(senderId, appendWorkbenchWorkspaceContentChange(
            journals.get(senderId)!,
            workbench,
            {
              workspaceFolderId: folder.id,
              paths: payload.paths ?? payload.path ?? null,
            },
          ));
        },
      }, folder.workspace.path);
    }
  }

  const harness: MutationPipelineHarness = {
    workbench,
    service,
    emit(folderId, eventType, eventPath) {
      const folder = workbench.folders.find((candidate) => candidate.id === folderId);
      if (!folder) throw new Error(`Unknown test Workspace Folder: ${folderId}`);
      const watcher = watchers.get(folder.workspace.path);
      if (!watcher) throw new Error(`Missing watcher for ${folder.workspace.path}`);
      watcher.listener(eventType, eventPath);
    },
    async flush() {
      await vi.advanceTimersByTimeAsync(200);
      await Promise.resolve();
      await Promise.resolve();
    },
    journal(senderId = senderIds[0]!) {
      return journals.get(senderId)!;
    },
    dispose() {
      service.closeAll();
    },
  };
  activeHarnesses.push(harness);
  return harness;
}

function emptyJournal(): WorkspaceContentChange {
  return { sequence: 0, entries: [] };
}

function workspace(id: string, path: string): Workspace {
  return {
    id,
    workspaceInstanceId: id,
    name: id,
    path,
    status: "recording",
  };
}

function fingerprint(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
