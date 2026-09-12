/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceResourceUri,
  type DataPort,
  type Workspace,
} from "../../../../packages/shared-ui/src";
import type { DocumentEditingSession } from "../../../../packages/shared-ui/src/editor/document-session/DocumentEditingSession";
import {
  closeAllDocumentWorkingCopies,
  closeDocumentWorkingCopy,
  getOrCreateDocumentWorkingCopy,
} from "../../../../packages/shared-ui/src/editor/document-session/documentWorkingCopies";
import { useWorkspaceLifecycle } from "../../../../src/features/app-shell/useWorkspaceLifecycle";
import { createWorkbenchDataService } from "../../../../src/features/data-workspace/workbenchDataPort";

const localFiles = vi.hoisted(() => ({
  attachWorkspaceFolder: vi.fn(),
  cloneRepository: vi.fn(),
  copyWorkspaceEntryBetweenRoots: vi.fn(),
  createLocalDataPort: vi.fn(),
  createLocalProject: vi.fn(),
  detachWorkspaceFolder: vi.fn(),
  forgetLastWorkspace: vi.fn(),
  getInitialWorkspace: vi.fn(),
  getRecentWorkspaces: vi.fn(),
  hydrateRecentWorkspaces: vi.fn(),
  openDroppedWorkspaceInCurrentWindow: vi.fn(),
  openWorkspaceInCurrentWindow: vi.fn(),
  openWorkspaceInNewWindow: vi.fn(),
  removeRecentWorkspace: vi.fn(),
  selectLocalProjectLocation: vi.fn(),
  selectWorkspaceFolder: vi.fn(),
  selectWorkspaceFolderInNewWindow: vi.fn(),
  selectWorkspaceFolderToAttach: vi.fn(),
}));

vi.mock("../../../../src/lib/localFiles", () => localFiles);

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  localFiles.getInitialWorkspace.mockResolvedValue({
    path: null,
    workspace: null,
    workspaces: [],
    error: null,
  });
  localFiles.getRecentWorkspaces.mockResolvedValue({ workspaces: [], errors: [] });
  localFiles.hydrateRecentWorkspaces.mockResolvedValue({ workspaces: [], errors: [], hydrated: true });
});

afterEach(async () => {
  act(() => root?.unmount());
  await closeAllDocumentWorkingCopies("workspace-switch").catch(() => undefined);
  root = null;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("multi-project Workspace experiment", () => {
  it("blocks both Project attachment paths while the experiment is off", async () => {
    const onWorkspaceOpenSettled = vi.fn();
    const harness = await renderHarness(false, onWorkspaceOpenSettled);

    await act(async () => harness.current.addProject());
    await act(async () => harness.current.addExistingProject("/projects/second"));

    expect(localFiles.selectWorkspaceFolderToAttach).not.toHaveBeenCalled();
    expect(localFiles.attachWorkspaceFolder).not.toHaveBeenCalled();
    expect(onWorkspaceOpenSettled).toHaveBeenCalledTimes(2);
  });

  it("allows both Project attachment paths after the experiment is enabled", async () => {
    localFiles.selectWorkspaceFolderToAttach.mockResolvedValue(null);
    localFiles.attachWorkspaceFolder.mockResolvedValue({
      status: "focused-existing",
      path: "/projects/second",
      workspace: null,
      workspaces: [],
    });
    const harness = await renderHarness(true, vi.fn());

    await act(async () => harness.current.addProject());
    await act(async () => harness.current.addExistingProject("/projects/second"));

    expect(localFiles.selectWorkspaceFolderToAttach).toHaveBeenCalledOnce();
    expect(localFiles.attachWorkspaceFolder).toHaveBeenCalledWith("/projects/second");
  });

  it.each([
    { enabled: false, label: "off" },
    { enabled: true, label: "on" },
  ])("runs the P0 save kernel identically with the multi-project experiment $label", async ({ enabled, label }) => {
    const primary = workspace(`primary-${label}`, "Primary", `/projects/primary-${label}`);
    const sibling = workspace(`sibling-${label}`, "Sibling", `/projects/sibling-${label}`);
    localFiles.getInitialWorkspace.mockResolvedValue({
      path: primary.path,
      workspace: primary,
      workspaces: [primary, sibling],
      error: null,
    });
    const harness = await renderHarness(enabled, vi.fn());
    const workbench = harness.current.workbenchWorkspace;
    expect(workbench).not.toBeNull();
    expect(workbench?.folders.map((folder) => folder.workspace.path)).toEqual([
      primary.path,
      sibling.path,
    ]);

    const providers = new Map<string, DataPort>();
    const service = createWorkbenchDataService(workbench!, {
      createProvider(folder) {
        const result = persistenceProvider(folder.id);
        providers.set(folder.id, result);
        return result;
      },
    });
    const persistence = service.dataPort.documentPersistence!;
    const firstPath = "legacy notes/README.md";
    const routedPath = "docs with space/群群.md";
    const firstResource = createWorkspaceResourceUri(workbench!.folders[0]!.uri, firstPath);
    const routedResource = createWorkspaceResourceUri(workbench!.folders[1]!.uri, routedPath);
    const firstCopy = getOrCreateDocumentWorkingCopy({
      documentId: firstResource,
      initialContent: "first initial",
      initialVersion: "v1",
      saveMode: "manual",
      persistence,
    });
    const routed = getOrCreateDocumentWorkingCopy({
      documentId: routedResource,
      initialContent: "routed initial",
      initialVersion: "v1",
      saveMode: "manual",
      persistence,
    });
    const detachFirst = editWorkingCopy(firstCopy.session, "first initial", "first saved");
    const detachRouted = editWorkingCopy(routed.session, "routed initial", "routed saved");

    await Promise.all([firstCopy.session.requestSave(), routed.session.requestSave()]);

    expect(firstCopy.identity.resourcePath).toBe(firstResource);
    expect(routed.identity.resourcePath).toBe(routedResource);
    expect(providers.get(workbench!.folders[0]!.id)?.documentPersistence?.persist)
      .toHaveBeenCalledWith(expect.objectContaining({ path: firstPath, content: "first saved" }));
    expect(providers.get(workbench!.folders[1]!.id)?.documentPersistence?.persist)
      .toHaveBeenCalledWith(expect.objectContaining({ path: routedPath, content: "routed saved" }));

    await expect(persistence.persist({
      path: routedPath,
      content: "ambiguous write must fail closed",
      baseVersion: "v1",
      reason: "manual",
    })).rejects.toThrow(/ambiguous.*Resource URI/i);
    await expect(persistence.persist({
      path: `puppyone-local:/workspace/${workbench!.folders[1]!.id}/${routedPath}`,
      content: "must not write",
      baseVersion: "v1",
      reason: "manual",
    })).rejects.toThrow(/Malformed Resource URI/i);
    expect(providers.get(workbench!.folders[0]!.id)?.documentPersistence?.persist).toHaveBeenCalledOnce();
    expect(providers.get(workbench!.folders[1]!.id)?.documentPersistence?.persist).toHaveBeenCalledOnce();

    detachFirst();
    detachRouted();
    await closeDocumentWorkingCopy({
      storageIdentity: persistence.storageIdentity,
      resourcePath: firstResource,
    });
    await closeDocumentWorkingCopy({
      storageIdentity: persistence.storageIdentity,
      resourcePath: routedResource,
    });
  });

  it("preserves the active Workbench composition while the experiment toggles at runtime", async () => {
    const primary = workspace("toggle-primary", "Primary", "/projects/toggle-primary");
    const sibling = workspace("toggle-sibling", "Sibling", "/projects/toggle-sibling");
    localFiles.getInitialWorkspace.mockResolvedValue({
      path: primary.path,
      workspace: primary,
      workspaces: [primary, sibling],
      error: null,
    });
    localFiles.selectWorkspaceFolderToAttach.mockResolvedValue(null);
    const harness = await renderHarness(true, vi.fn());
    const initialComposition = harness.current.workbenchWorkspace;
    const initialFolderUris = initialComposition?.folders.map((folder) => folder.uri);

    await harness.setExperimentEnabled(false);

    expect(harness.current.workbenchWorkspace).toBe(initialComposition);
    expect(harness.current.workbenchWorkspace?.folders.map((folder) => folder.uri)).toEqual(initialFolderUris);
    expect(harness.onWorkspaceActivated).toHaveBeenCalledOnce();
    await act(async () => harness.current.addProject());
    expect(localFiles.selectWorkspaceFolderToAttach).not.toHaveBeenCalled();

    await harness.setExperimentEnabled(true);

    expect(harness.current.workbenchWorkspace).toBe(initialComposition);
    expect(harness.current.workbenchWorkspace?.folders.map((folder) => folder.uri)).toEqual(initialFolderUris);
    expect(harness.onWorkspaceActivated).toHaveBeenCalledOnce();
    await act(async () => harness.current.addProject());
    expect(localFiles.selectWorkspaceFolderToAttach).toHaveBeenCalledOnce();
  });

  it("preserves Workbench identity when the primary Folder is detached", async () => {
    const primary = workspace("detach-primary", "Primary", "/projects/detach-primary");
    const sibling = workspace("detach-sibling", "Sibling", "/projects/detach-sibling");
    localFiles.getInitialWorkspace.mockResolvedValue({
      workspaceId: "workbench:stable-window",
      path: primary.path,
      workspace: primary,
      workspaces: [primary, sibling],
      error: null,
    });
    localFiles.detachWorkspaceFolder.mockResolvedValue({
      status: "detached-current",
      workspaceId: "workbench:stable-window",
      path: primary.path,
      workspace: primary,
      workspaces: [sibling],
    });
    const harness = await renderHarness(true, vi.fn());

    expect(harness.current.workbenchWorkspace?.id).toBe("workbench:stable-window");
    await act(async () => harness.current.removeProject(primary.path));

    expect(harness.current.workbenchWorkspace?.id).toBe("workbench:stable-window");
    expect(harness.current.workbenchWorkspace?.folders.map((folder) => folder.id)).toEqual([
      sibling.workspaceInstanceId,
    ]);
  });
});

async function renderHarness(
  multiRootWorkspacesEnabled: boolean,
  onWorkspaceOpenSettled: () => void,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  let controller: ReturnType<typeof useWorkspaceLifecycle> | null = null;
  const onWorkspaceActivated = vi.fn();
  const onWorkspaceCleared = vi.fn();

  function Harness({ enabled }: { enabled: boolean }) {
    controller = useWorkspaceLifecycle({
      multiRootWorkspacesEnabled: enabled,
      onWorkspaceActivated,
      onWorkspaceCleared,
      onWorkspaceOpenSettled,
    });
    return null;
  }

  const setExperimentEnabled = async (enabled: boolean) => {
    await act(async () => {
      root?.render(<Harness enabled={enabled} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  await setExperimentEnabled(multiRootWorkspacesEnabled);
  return {
    get current() {
      if (!controller) throw new Error("Workspace lifecycle controller did not initialize.");
      return controller;
    },
    onWorkspaceActivated,
    setExperimentEnabled,
  };
}

function workspace(id: string, name: string, path: string): Workspace {
  return {
    id,
    workspaceInstanceId: `instance-${id}`,
    name,
    path,
    status: "recording",
  };
}

function persistenceProvider(id: string): DataPort {
  return {
    listChildren: vi.fn(async () => []),
    documentPersistence: {
      kind: "local-fs",
      storageIdentity: `test:feature-matrix:${id}`,
      persist: vi.fn(async () => ({ ok: true as const, version: "v2" })),
    },
  };
}

function editWorkingCopy(
  session: DocumentEditingSession,
  initialContent: string,
  editedContent: string,
): () => void {
  let snapshot = { revision: `${session.documentId}:initial`, content: initialContent };
  const detach = session.attachSource({
    readSnapshot: () => snapshot,
    replaceContent: (content) => {
      snapshot = { revision: `${session.documentId}:external`, content };
      return snapshot;
    },
  });
  session.reportRevision({ revision: snapshot.revision, origin: "model-initialization" });
  snapshot = { revision: `${session.documentId}:edited`, content: editedContent };
  session.reportRevision({ revision: snapshot.revision, origin: "local-edit" });
  return detach;
}
