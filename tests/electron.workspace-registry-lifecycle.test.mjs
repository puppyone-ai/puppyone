import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceStateStore } from "../electron/main/workspace-state-store.mjs";

let root;

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-workspace-registry-"));
});

afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});

describe("workspace registry lifecycle", () => {
  it("clears the last closed composition without deleting recents or another window's selection", async () => {
    const store = createStore();
    const folders = await createFolders("closed", 2);
    await store.rememberWorkspaceComposition(folders.map(createWorkspace), { workbenchWorkspaceId: "current" });
    await store.clearActiveWorkspaceComposition("old-window");
    expect((await store.readLastActiveWorkspaceComposition()).paths).toHaveLength(2);
    await store.clearActiveWorkspaceComposition("current");
    expect((await store.readLastActiveWorkspaceComposition()).paths).toEqual([]);
    expect((await store.getRecentWorkspacesResult()).items).toHaveLength(2);
  });
  it("serializes concurrent multi-window mutations without losing records", async () => {
    const store = createStore();
    const folders = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const folder = path.join(root, `workspace-${index}`);
      await fs.promises.mkdir(folder);
      return folder;
    }));

    await Promise.all(folders.map((folder) => store.rememberRecentWorkspacePath(folder)));
    const result = await store.getRecentWorkspacesResult();

    expect(result.items).toHaveLength(12);
    expect(new Set(result.items.map((item) => item.workspace.workspaceInstanceId)).size).toBe(12);
    const raw = JSON.parse(await fs.promises.readFile(path.join(root, "registry.json"), "utf8"));
    expect(raw.version).toBe(6);
    expect(raw.recentWorkspaces).toHaveLength(12);
  });

  it("persists an ordered active Workspace composition independently from recents", async () => {
    const store = createStore();
    const folders = await createFolders("composition", 3);
    const workspaces = folders.map(createWorkspace);

    await store.rememberWorkspaceComposition(workspaces);

    const canonicalPaths = await Promise.all(folders.map((folder) => fs.promises.realpath(folder)));
    await expect(store.readLastActiveWorkspacePaths()).resolves.toEqual(canonicalPaths);
    expect((await store.getRecentWorkspacesResult()).items.map((item) => item.workspace.path))
      .toEqual([...canonicalPaths].reverse());
  });

  it("persists Workbench identity independently from the primary Folder", async () => {
    const store = createStore();
    const folders = await createFolders("stable-workbench", 2);
    const workspaces = folders.map(createWorkspace);

    await store.rememberWorkspaceComposition(workspaces, {
      workbenchWorkspaceId: "workbench:stable-composition",
    });
    await expect(store.readLastActiveWorkspaceComposition()).resolves.toMatchObject({
      workspaceId: "workbench:stable-composition",
    });

    await store.rememberWorkspaceComposition([workspaces[1]], {
      workbenchWorkspaceId: "workbench:stable-composition",
    });
    const restored = await store.readLastActiveWorkspaceComposition();
    expect(restored.workspaceId).toBe("workbench:stable-composition");
    expect(restored.paths).toEqual([await fs.promises.realpath(folders[1])]);
  });

  it("migrates a legacy active composition to one durable Workbench identity", async () => {
    const folder = path.join(root, "legacy-active");
    await fs.promises.mkdir(folder);
    await fs.promises.writeFile(path.join(root, "registry.json"), JSON.stringify({
      version: 5,
      lastActiveWorkspacePath: folder,
      lastActiveWorkspacePaths: [folder],
      recentWorkspacePaths: [folder],
    }));
    const store = createStore();

    const first = await store.readLastActiveWorkspaceComposition();
    const second = await store.readLastActiveWorkspaceComposition();
    const persisted = JSON.parse(await fs.promises.readFile(path.join(root, "registry.json"), "utf8"));

    expect(first.workspaceId).toMatch(/^workbench:/);
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(persisted.version).toBe(6);
    expect(persisted.lastActiveWorkbenchWorkspaceId).toBe(first.workspaceId);
  });

  it("does not truncate an active composition to the recent-project limit", async () => {
    const store = createStore();
    const folders = await createFolders("large-composition", 24);

    await store.rememberWorkspaceComposition(folders.map(createWorkspace));

    expect(await store.readLastActiveWorkspacePaths()).toHaveLength(24);
    expect((await store.getRecentWorkspacesResult()).items).toHaveLength(20);
  });

  it("serializes interleaved remember and remove mutations without resurrecting removed records", async () => {
    const store = createStore();
    const original = await createFolders("original", 8);
    const added = await createFolders("added", 8);
    await Promise.all(original.map((folder) => store.rememberRecentWorkspacePath(folder)));

    await Promise.all([
      ...original.slice(0, 4).map((folder) => store.removeRecentWorkspacePath(folder)),
      ...added.map((folder) => store.rememberRecentWorkspacePath(folder)),
    ]);

    const result = await store.getRecentWorkspacesResult();
    const paths = new Set(result.items.map((item) => item.workspace.path));
    const removedPaths = await Promise.all(original.slice(0, 4).map((folder) => fs.promises.realpath(folder)));
    const retainedPaths = await Promise.all(original.slice(4).map((folder) => fs.promises.realpath(folder)));
    const addedPaths = await Promise.all(added.map((folder) => fs.promises.realpath(folder)));
    expect(paths.size).toBe(12);
    for (const removed of removedPaths) expect(paths.has(removed)).toBe(false);
    for (const retained of retainedPaths) expect(paths.has(retained)).toBe(true);
    for (const folder of addedPaths) expect(paths.has(folder)).toBe(true);
  });

  it("removes a stale registration after its local folder no longer exists", async () => {
    const store = createStore();
    const folder = path.join(root, "stale-workspace");
    await fs.promises.mkdir(folder);
    await store.rememberRecentWorkspacePath(folder);
    const persistedPath = (await store.getRecentWorkspacesResult()).items[0].workspace.path;
    await fs.promises.rm(folder, { recursive: true, force: true });

    await expect(store.removeRecentWorkspacePath(persistedPath)).resolves.toEqual({
      removed: true,
      path: persistedPath,
    });
    await expect(store.getRecentWorkspacesResult()).resolves.toMatchObject({ items: [] });
  });

  it("deduplicates a symlink alias of the same physical workspace", async () => {
    const store = createStore();
    const workspace = path.join(root, "physical-workspace");
    const alias = path.join(root, "workspace-alias");
    await fs.promises.mkdir(workspace);
    try {
      await fs.promises.symlink(workspace, alias, "dir");
    } catch {
      return;
    }

    await store.rememberRecentWorkspacePath(workspace);
    await store.rememberRecentWorkspacePath(alias);

    const result = await store.getRecentWorkspacesResult();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].workspace.path).toBe(await fs.promises.realpath(workspace));
  });

  it("reconciles a moved path by fs identity instead of duplicating the workspace", async () => {
    const identities = new Map();
    const store = createStore({
      resolveWorkspaceIdentity: async (folderPath) => ({
        canonicalPath: folderPath,
        workspaceInstanceId: identities.get(folderPath) ?? "instance-1",
        fsIdentity: "fs:1:99",
      }),
    });
    const before = path.join(root, "before");
    const after = path.join(root, "after");
    await fs.promises.mkdir(before);
    await store.rememberRecentWorkspacePath(before);
    await fs.promises.rename(before, after);
    await store.rememberRecentWorkspacePath(after);

    const result = await store.getRecentWorkspacesResult();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].workspace.path).toBe(await fs.promises.realpath(after));
    expect(result.items[0].workspace).not.toHaveProperty("projectId");
  });

  it("persists and clears only a secret-free canonical Git remote hint", async () => {
    let remoteEnabled = true;
    const store = createStore({
      resolveWorkspaceIdentity: async (folderPath) => ({
        canonicalPath: folderPath,
        workspaceInstanceId: "instance-cloud",
        fsIdentity: "fs:1:100",
        puppyoneGitRemote: remoteEnabled ? {
          origin: "https://API.PUPPYONE.AI",
          projectId: "cloud-project-1",
          scopeId: null,
        } : null,
      }),
    });
    const folder = path.join(root, "cloud-linked");
    await fs.promises.mkdir(folder);

    await store.rememberRecentWorkspacePath(folder);
    expect((await store.getRecentWorkspacesResult()).items[0].workspace).toMatchObject({
      puppyoneGitRemote: {
        origin: "https://api.puppyone.ai",
        projectId: "cloud-project-1",
        scopeId: null,
      },
    });

    remoteEnabled = false;
    await store.rememberRecentWorkspacePath(folder);
    const localWorkspace = (await store.getRecentWorkspacesResult()).items[0].workspace;
    expect(localWorkspace).toMatchObject({ puppyoneGitRemote: null });
    expect(localWorkspace).not.toHaveProperty("hasPuppyoneCloudRemote");
  });

  it("drops the obsolete local Project identity when migrating the registry", async () => {
    const folder = path.join(root, "legacy-project-identity");
    await fs.promises.mkdir(folder);
    await fs.promises.writeFile(path.join(root, "registry.json"), JSON.stringify({
      version: 3,
      lastActiveWorkspacePath: folder,
      recentWorkspaces: [{
        workspaceInstanceId: "instance-legacy",
        projectId: "obsolete-local-project-id",
        path: folder,
        name: "Legacy",
      }],
    }), "utf8");
    const store = createStore();

    const beforeRewrite = await store.getRecentWorkspacesResult();
    expect(beforeRewrite.items[0].workspace).not.toHaveProperty("projectId");

    await store.rememberRecentWorkspacePath(folder, beforeRewrite.items[0].workspace);
    const persisted = JSON.parse(await fs.promises.readFile(path.join(root, "registry.json"), "utf8"));
    expect(persisted.version).toBe(6);
    expect(persisted.recentWorkspaces[0]).not.toHaveProperty("projectId");
  });

  it("quarantines corrupt JSON and reports a recoverable registry error", async () => {
    await fs.promises.writeFile(path.join(root, "registry.json"), "{broken", "utf8");
    const store = createStore();

    const result = await store.getRecentWorkspacesResult();

    expect(result.workspaces).toEqual([]);
    expect(result.errors[0].error).toMatch(/corrupt/i);
    expect(await fs.promises.readdir(root)).toContainEqual(
      expect.stringMatching(/^registry\.json\.corrupt\./),
    );
  });

  it("returns metadata immediately and hydrates at most four repositories concurrently", async () => {
    let active = 0;
    let peak = 0;
    const workspaceFromPath = vi.fn(async (folderPath) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return createWorkspace(folderPath);
    });
    const store = createStore({ workspaceFromPath });
    const folders = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
      const folder = path.join(root, `repo-${index}`);
      await fs.promises.mkdir(folder);
      return folder;
    }));
    await Promise.all(folders.map((folder) => store.rememberRecentWorkspacePath(folder)));

    const metadata = await store.getRecentWorkspacesResult();
    expect(metadata.hydrated).toBe(false);
    expect(workspaceFromPath).not.toHaveBeenCalled();

    const hydrated = await store.hydrateRecentWorkspacesResult();
    expect(hydrated.workspaces).toHaveLength(10);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

function createStore(overrides = {}) {
  const resolveWorkspaceIdentity = overrides.resolveWorkspaceIdentity ?? (async (folderPath) => ({
    canonicalPath: folderPath,
    workspaceInstanceId: `instance-${path.basename(folderPath)}`,
    fsIdentity: `fs-${path.basename(folderPath)}`,
  }));
  return createWorkspaceStateStore({
    app: { getPath: () => root },
    filename: "registry.json",
    canonicalizeWorkspacePath: async (value) => fs.promises.realpath(path.resolve(value)),
    resolveWorkspaceIdentity,
    workspaceFromPath: overrides.workspaceFromPath ?? (async (folderPath) => createWorkspace(folderPath)),
    logger: { warn: vi.fn() },
  });
}

function createWorkspace(folderPath) {
  return {
    id: `local:instance-${path.basename(folderPath)}`,
    name: path.basename(folderPath),
    path: folderPath,
    status: "protected",
    cloudState: "local",
    commitCount: 0,
    hydrationState: "ready",
  };
}

async function createFolders(prefix, count) {
  return Promise.all(Array.from({ length: count }, async (_, index) => {
    const folder = path.join(root, `${prefix}-${index}`);
    await fs.promises.mkdir(folder);
    return folder;
  }));
}
