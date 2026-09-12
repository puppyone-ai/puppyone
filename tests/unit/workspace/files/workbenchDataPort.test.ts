import { describe, expect, it, vi } from "vitest";
import {
  createWorkbenchWorkspace,
  createWorkspaceResourceUri,
  type DataPort,
  type Workspace,
  type WorkspaceFolder,
} from "../../../../packages/shared-ui/src";
import { createWorkbenchDataService } from "../../../../src/features/data-workspace/workbenchDataPort";

function workspace(id: string, name: string, path: string): Workspace {
  return {
    id,
    workspaceInstanceId: `instance-${id}`,
    name,
    path,
    status: "recording",
  };
}

function provider(name: string): DataPort {
  return {
    listChildren: vi.fn(async (path) => path === null ? [{
      id: "readme",
      name: "README.md",
      path: "README.md",
      type: "markdown",
    }] : []),
    resolveNode: vi.fn(async (path) => ({
      id: path,
      name: path.split("/").at(-1)!,
      path,
      type: "markdown",
    })),
    readFile: vi.fn(async (path) => ({
      path,
      name: path.split("/").at(-1)!,
      type: "markdown",
      content: `${name}:${path}`,
    })),
    documentPersistence: {
      kind: "local-fs",
      storageIdentity: `local-fs:${name}`,
      persist: vi.fn(async () => ({ ok: true as const, version: "v2" })),
    },
    createFile: vi.fn(async () => undefined),
    moveNode: vi.fn(async () => undefined),
    copyNode: vi.fn(async (path, target) => ({ path: `${target ? `${target}/` : ""}${path}` })),
  };
}

describe("WorkbenchDataService", () => {
  it("assembles ordered Workspace Folder roots into one Explorer tree", async () => {
    const workbench = createWorkbenchWorkspace([
      workspace("a", "Alpha", "/alpha"),
      workspace("b", "Beta", "/beta"),
    ]);
    const providers = new Map<string, DataPort>();
    const service = createWorkbenchDataService(workbench, {
      createProvider(folder) {
        const result = provider(folder.name);
        providers.set(folder.id, result);
        return result;
      },
    });

    const roots = await service.dataPort.listChildren(null);
    expect(roots.map((node) => ({ name: node.name, root: node.workspaceFolderRoot }))).toEqual([
      { name: "Alpha", root: true },
      { name: "Beta", root: true },
    ]);
    expect(roots[0]?.children?.[0]?.path).toBe(
      createWorkspaceResourceUri(workbench.folders[0]!.uri, "README.md"),
    );
    expect(roots[1]?.children?.[0]?.path).toBe(
      createWorkspaceResourceUri(workbench.folders[1]!.uri, "README.md"),
    );
  });

  it("routes equal relative paths to their owning Folder provider", async () => {
    const workbench = createWorkbenchWorkspace([
      workspace("a", "Alpha", "/alpha"),
      workspace("b", "Beta", "/beta"),
    ]);
    const service = createWorkbenchDataService(workbench, {
      createProvider: (folder) => provider(folder.name),
    });
    const first = createWorkspaceResourceUri(workbench.folders[0]!.uri, "README.md");
    const second = createWorkspaceResourceUri(workbench.folders[1]!.uri, "README.md");

    await expect(service.dataPort.readFile?.(first)).resolves.toMatchObject({
      path: first,
      content: "Alpha:README.md",
    });
    await expect(service.dataPort.readFile?.(second)).resolves.toMatchObject({
      path: second,
      content: "Beta:README.md",
    });
  });

  it("revokes each file URL through the Folder provider that minted it", async () => {
    const workbench = createWorkbenchWorkspace([
      workspace("a", "Alpha", "/alpha"),
      workspace("b", "Beta", "/beta"),
    ]);
    const providers = new Map<string, DataPort>();
    const service = createWorkbenchDataService(workbench, {
      createProvider(folder) {
        const result = {
          ...provider(folder.name),
          getFileUrl: vi.fn(async (path: string) => `blob:${folder.id}:${path}`),
          revokeFileUrl: vi.fn(async () => undefined),
        };
        providers.set(folder.id, result);
        return result;
      },
    });
    const second = createWorkspaceResourceUri(workbench.folders[1]!.uri, "image.png");

    const url = await service.dataPort.getFileUrl?.(second, { purpose: "file-preview" });
    await service.dataPort.revokeFileUrl?.(url!);

    expect(providers.get(workbench.folders[1]!.id)?.getFileUrl)
      .toHaveBeenCalledWith("image.png", { purpose: "file-preview" });
    expect(providers.get(workbench.folders[1]!.id)?.revokeFileUrl).toHaveBeenCalledWith(url);
    expect(providers.get(workbench.folders[0]!.id)?.revokeFileUrl).not.toHaveBeenCalled();
  });

  it("routes equal relative document writes to their owning Folder provider", async () => {
    const workbench = createWorkbenchWorkspace([
      workspace("a", "Alpha", "/alpha"),
      workspace("b", "Beta", "/beta"),
    ]);
    const providers = new Map<string, DataPort>();
    const service = createWorkbenchDataService(workbench, {
      createProvider(folder) {
        const result = provider(folder.name);
        providers.set(folder.id, result);
        return result;
      },
    });
    const first = createWorkspaceResourceUri(workbench.folders[0]!.uri, "README.md");
    const second = createWorkspaceResourceUri(workbench.folders[1]!.uri, "README.md");
    const persistence = service.dataPort.documentPersistence!;

    await persistence.persist({
      path: first,
      content: "alpha",
      baseVersion: "a-v1",
      reason: "manual",
    });
    await persistence.persist({
      path: second,
      content: "beta",
      baseVersion: "b-v1",
      reason: "manual",
    });

    expect(providers.get(workbench.folders[0]!.id)?.documentPersistence?.persist)
      .toHaveBeenCalledWith(expect.objectContaining({
        path: "README.md",
        content: "alpha",
        baseVersion: "a-v1",
      }));
    expect(providers.get(workbench.folders[1]!.id)?.documentPersistence?.persist)
      .toHaveBeenCalledWith(expect.objectContaining({
        path: "README.md",
        content: "beta",
        baseVersion: "b-v1",
      }));
  });

  it("rejects a malformed Resource URI before any Folder provider can write", async () => {
    const workbench = createWorkbenchWorkspace([
      workspace("a", "Alpha", "/alpha"),
      workspace("b", "Beta", "/beta"),
    ]);
    const providers = new Map<string, DataPort>();
    const service = createWorkbenchDataService(workbench, {
      createProvider(folder) {
        const result = provider(folder.name);
        providers.set(folder.id, result);
        return result;
      },
    });

    await expect(service.dataPort.documentPersistence?.persist({
      path: "puppyone-local:/workspace/folder-a/README.md",
      content: "must not write",
      baseVersion: "v1",
      reason: "manual",
    })).rejects.toThrow(/Malformed Resource URI/i);

    for (const candidate of providers.values()) {
      expect(candidate.documentPersistence?.persist).not.toHaveBeenCalled();
    }
  });

  it("routes root-level creation explicitly and rejects ambiguous provider paths", async () => {
    const workbench = createWorkbenchWorkspace([
      workspace("a", "Alpha", "/alpha"),
      workspace("b", "Beta", "/beta"),
    ]);
    const providers = new Map<string, DataPort>();
    const service = createWorkbenchDataService(workbench, {
      createProvider(folder: WorkspaceFolder) {
        const result = provider(folder.name);
        providers.set(folder.id, result);
        return result;
      },
    });
    const path = createWorkspaceResourceUri(workbench.folders[1]!.uri, "new.md");

    await service.dataPort.createFile?.(path, "hello");
    expect(providers.get(workbench.folders[1]!.id)?.createFile).toHaveBeenCalledWith("new.md", "hello");
    expect(() => service.resolveResource(null)).toThrow(/ambiguous.*Resource URI/i);
    expect(() => service.resolveResource("new.md")).toThrow(/ambiguous.*Resource URI/i);
  });

  it("returns null for stale resources from a different Workbench without weakening strict access", () => {
    const previousWorkbench = createWorkbenchWorkspace([
      workspace("a", "Alpha", "/alpha"),
    ]);
    const currentWorkbench = createWorkbenchWorkspace([
      workspace("b", "Beta", "/beta"),
    ]);
    const staleResource = createWorkspaceResourceUri(
      previousWorkbench.folders[0]!.uri,
      "README.md",
    );
    const service = createWorkbenchDataService(currentWorkbench, {
      createProvider: () => provider("Beta"),
    });

    expect(service.tryResolveResource(staleResource)).toBeNull();
    expect(() => service.resolveResource(staleResource))
      .toThrow(/outside the current Workbench Workspace/i);
  });

  it("rejects cross-Project moves without mutating either provider", async () => {
    const workbench = createWorkbenchWorkspace([
      workspace("a", "Alpha", "/alpha"),
      workspace("b", "Beta", "/beta"),
    ]);
    const providers = new Map<string, DataPort>();
    const service = createWorkbenchDataService(workbench, {
      createProvider(folder) {
        const result = provider(folder.name);
        providers.set(folder.id, result);
        return result;
      },
    });
    const source = createWorkspaceResourceUri(workbench.folders[0]!.uri, "README.md");
    const target = createWorkspaceResourceUri(workbench.folders[1]!.uri, "README.md");

    await expect(service.dataPort.moveNode?.(source, target)).rejects.toThrow(/across Projects/i);
    expect(providers.get(workbench.folders[0]!.id)?.moveNode).not.toHaveBeenCalled();
    expect(providers.get(workbench.folders[1]!.id)?.moveNode).not.toHaveBeenCalled();
  });

  it("copies across Project roots through the privileged multi-root bridge", async () => {
    const workbench = createWorkbenchWorkspace([
      workspace("a", "Alpha", "/alpha"),
      workspace("b", "Beta", "/beta"),
    ]);
    const copyBetweenRoots = vi.fn(async () => ({ path: "docs/README.md" }));
    const service = createWorkbenchDataService(workbench, {
      createProvider: (folder) => provider(folder.name),
      copyBetweenRoots,
    });
    const source = createWorkspaceResourceUri(workbench.folders[0]!.uri, "README.md");
    const target = createWorkspaceResourceUri(workbench.folders[1]!.uri, "docs");

    await expect(service.dataPort.copyNode?.(source, target)).resolves.toEqual({
      path: createWorkspaceResourceUri(workbench.folders[1]!.uri, "docs/README.md"),
    });
    expect(copyBetweenRoots).toHaveBeenCalledWith({
      sourceRootPath: "/alpha",
      targetRootPath: "/beta",
      fromPath: "README.md",
      targetFolderPath: "docs",
    });
  });

  it("keeps one-Folder Explorer presentation flat while retaining URI identity", async () => {
    const workbench = createWorkbenchWorkspace([workspace("a", "Alpha", "/alpha")]);
    const service = createWorkbenchDataService(workbench, {
      createProvider: () => provider("Alpha"),
    });

    const nodes = await service.dataPort.listChildren(null);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ name: "README.md" });
    expect(nodes[0]).not.toHaveProperty("workspaceFolderRoot");
    expect(nodes[0]?.path).toBe(createWorkspaceResourceUri(workbench.folders[0]!.uri, "README.md"));
  });
});
