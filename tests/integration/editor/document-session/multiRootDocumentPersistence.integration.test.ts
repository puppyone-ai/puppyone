/**
 * @vitest-environment happy-dom
 */
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkbenchWorkspaceContext,
  createWorkbenchWorkspace,
  createWorkspaceResourceUri,
  type DataPort,
} from "../../../../packages/shared-ui/src";
import {
  closeAllDocumentWorkingCopies,
  getOrCreateDocumentWorkingCopy,
} from "../../../../packages/shared-ui/src/editor/document-session/documentWorkingCopies";
import type { DocumentEditingSession } from "../../../../packages/shared-ui/src/editor/document-session/DocumentEditingSession";
import { createWorkbenchDataService } from "../../../../src/features/data-workspace/workbenchDataPort";

let temporaryRoot: string | null = null;
let originalDesktopBridge: Window["puppyoneDesktop"];

afterEach(async () => {
  await closeAllDocumentWorkingCopies("workspace-switch").catch(() => undefined);
  window.puppyoneDesktop = originalDesktopBridge;
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = null;
  vi.restoreAllMocks();
});

describe("multi-root document persistence", () => {
  it("retains one dirty Working Copy when the primary Folder is detached", async () => {
    const initial = createWorkbenchWorkspace([
      {
        id: "alpha",
        workspaceInstanceId: "instance-alpha",
        name: "Alpha",
        path: "/alpha",
        status: "recording",
      },
      {
        id: "beta",
        workspaceInstanceId: "instance-beta",
        name: "Beta",
        path: "/beta",
        status: "recording",
      },
    ], { id: "workbench:stable-window" });
    const context = new WorkbenchWorkspaceContext(initial);
    const createProvider = (): DataPort => ({
      listChildren: vi.fn(async () => []),
      documentPersistence: {
        kind: "local-fs",
        storageIdentity: "provider-local",
        persist: vi.fn(async () => ({ ok: true as const, version: "v2" })),
      },
    });
    const beforeService = createWorkbenchDataService(initial, { createProvider });
    const retainedResource = createWorkspaceResourceUri(initial.folders[1]!.uri, "notes.md");
    const before = getOrCreateDocumentWorkingCopy({
      documentId: retainedResource,
      initialContent: "before",
      initialVersion: "v1",
      saveMode: "manual",
      persistence: beforeService.dataPort.documentPersistence!,
    });
    const source = bindSource(before.session, "before", "dirty local edit");
    source.edit();

    const next = await context.detachFolder(initial.folders[0]!.id);
    const afterService = createWorkbenchDataService(next, { createProvider });
    const after = getOrCreateDocumentWorkingCopy({
      documentId: retainedResource,
      initialContent: "stale reload must not replace dirty content",
      initialVersion: "v1",
      saveMode: "manual",
      persistence: afterService.dataPort.documentPersistence!,
    });

    expect(next.id).toBe("workbench:stable-window");
    expect(afterService.dataPort.documentPersistence?.storageIdentity)
      .toBe(beforeService.dataPort.documentPersistence?.storageIdentity);
    expect(after.session).toBe(before.session);

    source.detach();
  });

  it("persists and reopens same-named documents in two real Workspace roots without crossing providers", async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "puppyone-multi-root-save-"));
    const firstRoot = join(temporaryRoot, "Alpha Project");
    const secondRoot = join(temporaryRoot, "Beta 项目");
    const relativePath = "docs with space/群群.md";
    const firstInitial = "alpha initial";
    const secondInitial = "beta initial";
    await Promise.all([
      createFile(firstRoot, relativePath, firstInitial),
      createFile(secondRoot, relativePath, secondInitial),
    ]);

    const roots = new Set([firstRoot, secondRoot]);
    const writeWorkspaceFile = vi.fn(async (request: {
      rootPath: string;
      path: string;
      content: string;
      expectedVersion?: string | null;
    }) => {
      expect(roots.has(request.rootPath)).toBe(true);
      expect(request.path).toBe(relativePath);
      expect(request.path).not.toMatch(/puppyone-local:/i);
      const absolutePath = join(request.rootPath, request.path);
      const current = await readFile(absolutePath, "utf8");
      if (request.expectedVersion && request.expectedVersion !== fingerprint(current)) {
        return { ok: false as const, kind: "conflict" as const, version: fingerprint(current) };
      }
      await writeFile(absolutePath, request.content, "utf8");
      return { ok: true as const, version: fingerprint(request.content) };
    });
    const readWorkspaceFile = vi.fn(async (request: { rootPath: string; path: string }) => {
      expect(roots.has(request.rootPath)).toBe(true);
      expect(request.path).toBe(relativePath);
      const content = await readFile(join(request.rootPath, request.path), "utf8");
      return {
        path: request.path,
        name: "群群.md",
        type: "markdown" as const,
        content,
        version: fingerprint(content),
      };
    });
    originalDesktopBridge = window.puppyoneDesktop;
    window.puppyoneDesktop = {
      readFile: readWorkspaceFile,
      writeFile: writeWorkspaceFile,
    } as unknown as Window["puppyoneDesktop"];

    const workbench = createWorkbenchWorkspace([
      {
        id: "alpha",
        workspaceInstanceId: "instance-alpha",
        name: "Alpha",
        path: firstRoot,
        status: "recording",
      },
      {
        id: "beta",
        workspaceInstanceId: "instance-beta",
        name: "Beta",
        path: secondRoot,
        status: "recording",
      },
    ]);
    const service = createWorkbenchDataService(workbench);
    const persistence = service.dataPort.documentPersistence!;
    const firstResource = createWorkspaceResourceUri(workbench.folders[0]!.uri, relativePath);
    const secondResource = createWorkspaceResourceUri(workbench.folders[1]!.uri, relativePath);
    const first = getOrCreateDocumentWorkingCopy({
      documentId: firstResource,
      initialContent: firstInitial,
      initialVersion: fingerprint(firstInitial),
      saveMode: "auto",
      persistence,
    });
    const second = getOrCreateDocumentWorkingCopy({
      documentId: secondResource,
      initialContent: secondInitial,
      initialVersion: fingerprint(secondInitial),
      saveMode: "manual",
      persistence,
    });
    const firstSource = bindSource(first.session, firstInitial, "alpha saved");
    const secondSource = bindSource(second.session, secondInitial, "beta saved");

    expect(first.identity.resourcePath).toBe(firstResource);
    expect(second.identity.resourcePath).toBe(secondResource);
    expect(first.identity.resourcePath).not.toBe(second.identity.resourcePath);

    firstSource.edit();
    secondSource.edit();
    await Promise.all([
      first.session.flushCurrent("document-close"),
      second.session.requestSave(),
    ]);

    expect(await readFile(join(firstRoot, relativePath), "utf8")).toBe("alpha saved");
    expect(await readFile(join(secondRoot, relativePath), "utf8")).toBe("beta saved");
    await expect(service.dataPort.readFile?.(firstResource)).resolves.toMatchObject({
      path: firstResource,
      content: "alpha saved",
    });
    await expect(service.dataPort.readFile?.(secondResource)).resolves.toMatchObject({
      path: secondResource,
      content: "beta saved",
    });
    expect(writeWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: firstRoot,
      path: relativePath,
      content: "alpha saved",
    }));
    expect(writeWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: secondRoot,
      path: relativePath,
      content: "beta saved",
    }));

    firstSource.detach();
    secondSource.detach();
  });
});

async function createFile(rootPath: string, relativePath: string, content: string): Promise<void> {
  const parentPath = relativePath.slice(0, relativePath.lastIndexOf("/"));
  await mkdir(join(rootPath, parentPath), { recursive: true });
  await writeFile(join(rootPath, relativePath), content, "utf8");
}

function bindSource(
  session: DocumentEditingSession,
  initialContent: string,
  editedContent: string,
) {
  let snapshot = { revision: `${session.documentId}:initial`, content: initialContent };
  const detach = session.attachSource({
    readSnapshot: () => snapshot,
    replaceContent: (content) => {
      snapshot = { revision: `${session.documentId}:external`, content };
      return snapshot;
    },
  });
  session.reportRevision({ revision: snapshot.revision, origin: "model-initialization" });
  return {
    edit() {
      snapshot = { revision: `${session.documentId}:edited`, content: editedContent };
      session.reportRevision({ revision: snapshot.revision, origin: "local-edit" });
    },
    detach,
  };
}

function fingerprint(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
