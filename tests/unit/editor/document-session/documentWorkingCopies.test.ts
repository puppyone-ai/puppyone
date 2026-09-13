import type { DocumentPersistencePort } from "@puppyone/shared-ui";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceResourceUri,
  createWorkspaceRootUri,
} from "../../../../packages/shared-ui/src/core/resourceUri";
import {
  closeDocumentWorkingCopiesUnderResource,
  closeDocumentWorkingCopy,
  getOrCreateDocumentWorkingCopy,
} from "../../../../packages/shared-ui/src/editor/document-session/documentWorkingCopies";

describe("document Working Copy registry", () => {
  it("keeps one session per stable storage identity and document across adapter recreation", async () => {
    const firstPersistence: DocumentPersistencePort = {
      kind: "local-fs",
      storageIdentity: "test:working-copies",
      persist: vi.fn<DocumentPersistencePort["persist"]>(async () => ({ ok: true, version: "v2" })),
    };
    const recreatedPersistence: DocumentPersistencePort = {
      kind: "local-fs",
      storageIdentity: "test:working-copies",
      persist: vi.fn<DocumentPersistencePort["persist"]>(async () => ({ ok: true, version: "v3" })),
    };
    const first = getOrCreateDocumentWorkingCopy({
      documentId: "working-copy-a.md",
      initialContent: "a",
      saveMode: "auto",
      persistence: firstPersistence,
    });
    const second = getOrCreateDocumentWorkingCopy({
      documentId: "working-copy-a.md",
      initialContent: "stale render content",
      saveMode: "auto",
      persistence: recreatedPersistence,
    });

    expect(second.session).toBe(first.session);
    await closeDocumentWorkingCopy({
      storageIdentity: "test:working-copies",
      resourcePath: "working-copy-a.md",
    });

    const reopened = getOrCreateDocumentWorkingCopy({
      documentId: "working-copy-a.md",
      initialContent: "a",
      saveMode: "auto",
      persistence: firstPersistence,
    });
    expect(reopened.session).not.toBe(first.session);
    await closeDocumentWorkingCopy({
      storageIdentity: "test:working-copies",
      resourcePath: "working-copy-a.md",
    });
  });

  it("keeps equal resource paths isolated across storage identities", async () => {
    const first = getOrCreateDocumentWorkingCopy({
      documentId: "same.md",
      initialContent: "first",
      saveMode: "auto",
      persistence: {
        kind: "local-fs",
        storageIdentity: "test:workspace-a",
        persist: vi.fn<DocumentPersistencePort["persist"]>(async () => ({ ok: true, version: "a2" })),
      },
    });
    const second = getOrCreateDocumentWorkingCopy({
      documentId: "same.md",
      initialContent: "second",
      saveMode: "auto",
      persistence: {
        kind: "local-fs",
        storageIdentity: "test:workspace-b",
        persist: vi.fn<DocumentPersistencePort["persist"]>(async () => ({ ok: true, version: "b2" })),
      },
    });

    expect(second.session).not.toBe(first.session);
    await closeDocumentWorkingCopy({ storageIdentity: "test:workspace-a", resourcePath: "same.md" });
    await closeDocumentWorkingCopy({ storageIdentity: "test:workspace-b", resourcePath: "same.md" });
  });

  it("keeps equal provider paths isolated across Workspace Folders in one Workbench", async () => {
    const rootA = createWorkspaceRootUri("folder-a");
    const rootB = createWorkspaceRootUri("folder-b");
    const persistence: DocumentPersistencePort = {
      kind: "local-fs",
      storageIdentity: "test:multi-root-workbench",
      persist: vi.fn<DocumentPersistencePort["persist"]>(async () => ({ ok: true, version: "v2" })),
    };
    const first = getOrCreateDocumentWorkingCopy({
      documentId: createWorkspaceResourceUri(rootA, "same.md"),
      initialContent: "first",
      saveMode: "auto",
      persistence,
    });
    const second = getOrCreateDocumentWorkingCopy({
      documentId: createWorkspaceResourceUri(rootB, "same.md"),
      initialContent: "second",
      saveMode: "auto",
      persistence,
    });

    expect(second.session).not.toBe(first.session);

    await closeDocumentWorkingCopiesUnderResource(persistence.storageIdentity, rootA);
    await closeDocumentWorkingCopiesUnderResource(persistence.storageIdentity, rootB);
  });

  it("closes one Workspace Folder without releasing a sibling Folder's Working Copy", async () => {
    const rootA = createWorkspaceRootUri("folder-a");
    const rootB = createWorkspaceRootUri("folder-b");
    const resourceA = createWorkspaceResourceUri(rootA, "same.md");
    const resourceB = createWorkspaceResourceUri(rootB, "same.md");
    const persistence: DocumentPersistencePort = {
      kind: "local-fs",
      storageIdentity: "test:multi-root-close",
      persist: vi.fn<DocumentPersistencePort["persist"]>(async () => ({ ok: true, version: "v2" })),
    };
    const first = getOrCreateDocumentWorkingCopy({
      documentId: resourceA,
      initialContent: "first",
      saveMode: "auto",
      persistence,
    });
    const second = getOrCreateDocumentWorkingCopy({
      documentId: resourceB,
      initialContent: "second",
      saveMode: "auto",
      persistence,
    });

    await closeDocumentWorkingCopiesUnderResource(persistence.storageIdentity, rootA);

    const reopenedFirst = getOrCreateDocumentWorkingCopy({
      documentId: resourceA,
      initialContent: "first",
      saveMode: "auto",
      persistence,
    });
    const retainedSecond = getOrCreateDocumentWorkingCopy({
      documentId: resourceB,
      initialContent: "second",
      saveMode: "auto",
      persistence,
    });
    expect(reopenedFirst.session).not.toBe(first.session);
    expect(retainedSecond.session).toBe(second.session);

    await closeDocumentWorkingCopiesUnderResource(persistence.storageIdentity, rootA);
    await closeDocumentWorkingCopiesUnderResource(persistence.storageIdentity, rootB);
  });
});
