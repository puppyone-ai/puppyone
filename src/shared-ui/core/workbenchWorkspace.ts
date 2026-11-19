import type { Workspace } from "./types";
import {
  ResourceUriIdentityService,
  createWorkspaceRootUri,
  parseResourceUri,
  type ResourceUri,
} from "./resourceUri";

export type WorkspaceFolderId = string;
export type WorkbenchWorkspaceId = string;
export type WorkspaceFolderTrustState = "trusted" | "untrusted" | "unknown";

export type WorkspaceFolderCapabilities = Readonly<{
  read: boolean;
  write: boolean;
  watch: boolean;
  execute: boolean;
}>;

export type WorkspaceFolder = Readonly<{
  id: WorkspaceFolderId;
  uri: ResourceUri;
  name: string;
  index: number;
  capabilities: WorkspaceFolderCapabilities;
  trustState: WorkspaceFolderTrustState;
  /** Current single-folder presentation adapter; never use it as global identity. */
  workspace: Readonly<Workspace>;
}>;

export type WorkbenchWorkspace = Readonly<{
  id: WorkbenchWorkspaceId;
  folders: readonly WorkspaceFolder[];
  transient: boolean;
  revision: number;
  configuration?: ResourceUri;
}>;

export type WorkspaceFoldersChange = Readonly<{
  workspaceId: WorkbenchWorkspaceId;
  revision: number;
  added: readonly WorkspaceFolder[];
  removed: readonly WorkspaceFolder[];
  changed: readonly WorkspaceFolder[];
}>;

export type WillChangeWorkspaceFoldersEvent = WorkspaceFoldersChange & Readonly<{
  join: (barrier: Promise<unknown>) => void;
  veto: (reason?: string) => void;
}>;

export type WorkspaceFoldersListener<T> = (event: T) => void;
export type Disposable = () => void;

const DEFAULT_FOLDER_CAPABILITIES: WorkspaceFolderCapabilities = Object.freeze({
  read: true,
  write: true,
  watch: true,
  execute: true,
});

export function createWorkspaceFolder(
  workspace: Workspace,
  options: Readonly<{
    index?: number;
    capabilities?: Partial<WorkspaceFolderCapabilities>;
    trustState?: WorkspaceFolderTrustState;
    uri?: ResourceUri;
  }> = {},
): WorkspaceFolder {
  const id = workspace.workspaceInstanceId?.trim() || workspace.id.trim();
  if (!id) throw new TypeError("Workspace Folder identity is required.");
  return freezeFolder({
    id,
    uri: options.uri ?? createWorkspaceRootUri(id),
    name: workspace.name,
    index: normalizeIndex(options.index ?? 0),
    capabilities: { ...DEFAULT_FOLDER_CAPABILITIES, ...options.capabilities },
    trustState: options.trustState ?? "trusted",
    workspace,
  });
}

export function createSingleFolderWorkbenchWorkspace(workspace: Workspace): WorkbenchWorkspace {
  return createWorkbenchWorkspace([workspace]);
}

/**
 * Creates the first immutable snapshot for an ordered window composition.
 * Folder order is presentation state only. Production callers should supply
 * the main-process-owned identity so adding, removing, or reordering any
 * Folder never changes Editor or persistence scope identity.
 */
export function createWorkbenchWorkspace(
  workspaces: readonly Workspace[],
  options: Readonly<{ id?: WorkbenchWorkspaceId }> = {},
): WorkbenchWorkspace {
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw new TypeError("A Workbench Workspace requires at least one Folder.");
  }
  const folders = workspaces.map((workspace, index) => createWorkspaceFolder(workspace, { index }));
  return freezeWorkspace({
    id: normalizeWorkbenchWorkspaceId(options.id ?? createTransientWorkbenchWorkspaceId()),
    folders,
    transient: true,
    revision: 0,
  });
}

/**
 * Window-local authority for an immutable 0/1/N Folder snapshot. Mutations are
 * serialized and publish only after every pre-change durability barrier settles.
 */
export class WorkbenchWorkspaceContext {
  readonly #identity: ResourceUriIdentityService;
  readonly #willChangeListeners = new Set<WorkspaceFoldersListener<WillChangeWorkspaceFoldersEvent>>();
  readonly #didChangeListeners = new Set<WorkspaceFoldersListener<WorkspaceFoldersChange>>();
  #workspace: WorkbenchWorkspace;
  #mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    initialWorkspace: WorkbenchWorkspace,
    options: Readonly<{ identity?: ResourceUriIdentityService }> = {},
  ) {
    this.#identity = options.identity ?? new ResourceUriIdentityService();
    this.#workspace = normalizeWorkspace(initialWorkspace);
  }

  getWorkspace(): WorkbenchWorkspace {
    return this.#workspace;
  }

  getWorkspaceFolder(resource: ResourceUri): WorkspaceFolder | undefined {
    return this.#workspace.folders
      .filter((folder) => this.#identity.isEqualOrParent(resource, folder.uri))
      .sort((first, second) => uriDepth(second.uri) - uriDepth(first.uri))[0];
  }

  onWillChangeWorkspaceFolders(
    listener: WorkspaceFoldersListener<WillChangeWorkspaceFoldersEvent>,
  ): Disposable {
    this.#willChangeListeners.add(listener);
    return () => this.#willChangeListeners.delete(listener);
  }

  onDidChangeWorkspaceFolders(
    listener: WorkspaceFoldersListener<WorkspaceFoldersChange>,
  ): Disposable {
    this.#didChangeListeners.add(listener);
    return () => this.#didChangeListeners.delete(listener);
  }

  attachFolder(folder: WorkspaceFolder, index = this.#workspace.folders.length): Promise<WorkbenchWorkspace> {
    return this.#enqueue(async () => {
      if (this.#workspace.folders.some((candidate) => candidate.id === folder.id)) {
        throw new Error(`Workspace Folder ${folder.id} is already attached.`);
      }
      const folders = [...this.#workspace.folders];
      folders.splice(Math.min(normalizeIndex(index), folders.length), 0, folder);
      return this.#replaceFolders(folders);
    });
  }

  detachFolder(folderId: WorkspaceFolderId): Promise<WorkbenchWorkspace> {
    return this.#enqueue(() => this.#replaceFolders(
      this.#workspace.folders.filter((folder) => folder.id !== folderId),
    ));
  }

  reorderFolder(folderId: WorkspaceFolderId, index: number): Promise<WorkbenchWorkspace> {
    return this.#enqueue(() => {
      const currentIndex = this.#workspace.folders.findIndex((folder) => folder.id === folderId);
      if (currentIndex < 0) throw new Error(`Workspace Folder ${folderId} is not attached.`);
      const folders = [...this.#workspace.folders];
      const [folder] = folders.splice(currentIndex, 1);
      folders.splice(Math.min(normalizeIndex(index), folders.length), 0, folder!);
      return this.#replaceFolders(folders);
    });
  }

  replaceFolders(folders: readonly WorkspaceFolder[]): Promise<WorkbenchWorkspace> {
    return this.#enqueue(() => this.#replaceFolders(folders));
  }

  #enqueue(operation: () => Promise<WorkbenchWorkspace> | WorkbenchWorkspace): Promise<WorkbenchWorkspace> {
    const result = this.#mutationQueue.then(operation);
    this.#mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async #replaceFolders(folders: readonly WorkspaceFolder[]): Promise<WorkbenchWorkspace> {
    const normalizedFolders = normalizeFolders(folders);
    const change = calculateChange(this.#workspace, normalizedFolders);
    if (change.added.length === 0 && change.removed.length === 0 && change.changed.length === 0) {
      return this.#workspace;
    }

    const nextRevision = this.#workspace.revision + 1;
    const pendingChange = freezeChange({ ...change, revision: nextRevision });
    const barriers: Promise<unknown>[] = [];
    let vetoReason: string | null = null;
    let acceptingBarriers = true;
    const event: WillChangeWorkspaceFoldersEvent = Object.freeze({
      ...pendingChange,
      join: (barrier: Promise<unknown>) => {
        if (!acceptingBarriers) throw new Error("Workspace Folder barriers must be joined synchronously.");
        if (!barrier || typeof barrier.then !== "function") {
          throw new TypeError("Workspace Folder change barrier must be a Promise.");
        }
        barriers.push(Promise.resolve(barrier));
      },
      veto: (reason = "Workspace Folder change was vetoed.") => {
        if (!acceptingBarriers) throw new Error("Workspace Folder changes must be vetoed synchronously.");
        vetoReason = reason;
      },
    });

    try {
      for (const listener of this.#willChangeListeners) listener(event);
    } finally {
      acceptingBarriers = false;
    }
    if (vetoReason) throw new Error(vetoReason);
    await Promise.all(barriers);

    this.#workspace = freezeWorkspace({
      ...this.#workspace,
      folders: normalizedFolders,
      revision: nextRevision,
    });
    for (const listener of this.#didChangeListeners) listener(pendingChange);
    return this.#workspace;
  }
}

function normalizeWorkspace(workspace: WorkbenchWorkspace): WorkbenchWorkspace {
  return freezeWorkspace({
    ...workspace,
    id: normalizeWorkbenchWorkspaceId(workspace?.id),
    revision: Number.isSafeInteger(workspace.revision) && workspace.revision >= 0
      ? workspace.revision
      : 0,
    folders: normalizeFolders(workspace.folders),
  });
}

function normalizeFolders(folders: readonly WorkspaceFolder[]): readonly WorkspaceFolder[] {
  if (!Array.isArray(folders)) throw new TypeError("Workspace folders must be an array.");
  const ids = new Set<string>();
  return Object.freeze(folders.map((folder, index) => {
    if (!folder?.id?.trim()) throw new TypeError("Workspace Folder identity is required.");
    if (ids.has(folder.id)) throw new Error(`Duplicate Workspace Folder identity: ${folder.id}.`);
    ids.add(folder.id);
    return freezeFolder({ ...folder, index });
  }));
}

function calculateChange(
  workspace: WorkbenchWorkspace,
  nextFolders: readonly WorkspaceFolder[],
): Omit<WorkspaceFoldersChange, "revision"> {
  const currentById = new Map(workspace.folders.map((folder) => [folder.id, folder]));
  const nextById = new Map(nextFolders.map((folder) => [folder.id, folder]));
  return {
    workspaceId: workspace.id,
    added: nextFolders.filter((folder) => !currentById.has(folder.id)),
    removed: workspace.folders.filter((folder) => !nextById.has(folder.id)),
    changed: nextFolders.filter((folder) => {
      const current = currentById.get(folder.id);
      return Boolean(current && !workspaceFolderEquals(current, folder));
    }),
  };
}

function workspaceFolderEquals(first: WorkspaceFolder, second: WorkspaceFolder): boolean {
  return first.id === second.id
    && first.uri === second.uri
    && first.name === second.name
    && first.index === second.index
    && first.trustState === second.trustState
    && JSON.stringify(first.capabilities) === JSON.stringify(second.capabilities)
    && JSON.stringify(first.workspace) === JSON.stringify(second.workspace);
}

function freezeFolder(folder: WorkspaceFolder): WorkspaceFolder {
  return Object.freeze({
    ...folder,
    capabilities: Object.freeze({ ...folder.capabilities }),
    workspace: Object.freeze({ ...folder.workspace }),
  });
}

function freezeWorkspace(workspace: WorkbenchWorkspace): WorkbenchWorkspace {
  return Object.freeze({ ...workspace, folders: Object.freeze([...workspace.folders]) });
}

function freezeChange(change: WorkspaceFoldersChange): WorkspaceFoldersChange {
  return Object.freeze({
    ...change,
    added: Object.freeze([...change.added]),
    removed: Object.freeze([...change.removed]),
    changed: Object.freeze([...change.changed]),
  });
}

function normalizeIndex(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.trunc(index));
}

function normalizeWorkbenchWorkspaceId(value: string | undefined): WorkbenchWorkspaceId {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) throw new TypeError("Workbench Workspace identity is required.");
  return id;
}

function createTransientWorkbenchWorkspaceId(): WorkbenchWorkspaceId {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `workbench:${randomUuid}`;
  return `workbench:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function uriDepth(uri: ResourceUri): number {
  return parseResourceUri(uri).path.split("/").filter(Boolean).length;
}
