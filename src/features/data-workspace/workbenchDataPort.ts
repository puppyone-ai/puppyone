import {
  ResourceUriIdentityService,
  assertValidDataResourceReference,
  createWorkspaceResourceUri,
  getWorkspaceResourcePath,
  isDataResourceUri,
  type AppPreviewController,
  type DataNode,
  type DataPort,
  type DataTemplateInstantiationResult,
  type FileContent,
  type ResourceUri,
  type WorkbenchWorkspace,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import {
  copyWorkspaceEntryBetweenRoots,
  createLocalDataPort,
} from "../../lib/localFiles";

export type ResolvedWorkbenchDataResource = Readonly<{
  folder: WorkspaceFolder;
  providerPath: string | null;
  resourceUri: ResourceUri;
}>;

export type WorkbenchDataService = Readonly<{
  dataPort: DataPort;
  rootResourcePaths: readonly ResourceUri[];
  resolveResource: (path: string | null) => ResolvedWorkbenchDataResource;
  tryResolveResource: (path: string | null) => ResolvedWorkbenchDataResource | null;
}>;

const resourceIdentity = new ResourceUriIdentityService();

/**
 * URI-routed file service for one Workbench Workspace. Local DataPorts remain
 * root-closed providers; this adapter is the only place that maps a Resource
 * URI to an authorized provider and provider-relative path.
 */
export function createWorkbenchDataService(
  workbench: WorkbenchWorkspace,
  options: Readonly<{
    createProvider?: (folder: WorkspaceFolder) => DataPort;
    copyBetweenRoots?: typeof copyWorkspaceEntryBetweenRoots;
  }> = {},
): WorkbenchDataService {
  if (workbench.folders.length === 0) {
    throw new TypeError("A Workbench data service requires at least one Workspace Folder.");
  }

  const providers = new Map(workbench.folders.map((folder) => [
    folder.id,
    options.createProvider?.(folder) ?? createLocalDataPort(folder.workspace.path),
  ]));
  const fileUrlOwners = new Map<string, DataPort>();
  const copyBetweenRoots = options.copyBetweenRoots ?? copyWorkspaceEntryBetweenRoots;
  const resolveResource = (path: string | null): ResolvedWorkbenchDataResource => {
    const resourceIsUri = isDataResourceUri(path);
    if (!resourceIsUri) assertValidDataResourceReference(path);
    if (!path || !resourceIsUri) {
      if (workbench.folders.length !== 1) {
        throw new TypeError(
          "A provider-relative path is ambiguous in a multi-Folder Workspace. Use a Resource URI.",
        );
      }
      const folder = workbench.folders[0]!;
      return {
        folder,
        providerPath: path,
        resourceUri: path ? createWorkspaceResourceUri(folder.uri, path) : folder.uri,
      };
    }

    const folder = [...workbench.folders]
      .filter((candidate) => resourceIdentity.isEqualOrParent(path, candidate.uri))
      .sort((first, second) => second.uri.length - first.uri.length)[0];
    if (!folder) throw new Error("Resource is outside the current Workbench Workspace.");
    return {
      folder,
      providerPath: getWorkspaceResourcePath(folder.uri, path) || null,
      resourceUri: path,
    };
  };
  const tryResolveResource = (path: string | null): ResolvedWorkbenchDataResource | null => {
    try {
      return resolveResource(path);
    } catch {
      return null;
    }
  };
  const requireProvider = (folder: WorkspaceFolder): DataPort => {
    const provider = providers.get(folder.id);
    if (!provider) throw new Error(`No file provider is registered for Workspace Folder ${folder.name}.`);
    return provider;
  };
  const toResourcePath = (folder: WorkspaceFolder, path: string): ResourceUri => (
    createWorkspaceResourceUri(folder.uri, path)
  );
  const mapNode = (folder: WorkspaceFolder, node: DataNode): DataNode => {
    const resourceUri = toResourcePath(folder, node.path);
    return {
      ...node,
      id: resourceUri,
      path: resourceUri,
      resourceUri,
      workspaceFolderId: folder.id,
      children: node.children?.map((child) => mapNode(folder, child)) ?? node.children,
    };
  };
  const mapContent = (folder: WorkspaceFolder, content: FileContent): FileContent => ({
    ...content,
    path: toResourcePath(folder, content.path),
  });
  const mapTemplateResult = (
    folder: WorkspaceFolder,
    result: DataTemplateInstantiationResult,
  ): DataTemplateInstantiationResult => ({
    ...result,
    rootPath: toResourcePath(folder, result.rootPath),
    openPath: toResourcePath(folder, result.openPath),
    createdPaths: result.createdPaths.map((path) => toResourcePath(folder, path)),
  });
  const createRootNode = async (folder: WorkspaceFolder): Promise<DataNode> => {
    const children = await requireProvider(folder).listChildren(null);
    return {
      id: folder.uri,
      name: folder.name,
      path: folder.uri,
      type: "folder",
      source: "local",
      hasChildren: children.length > 0,
      children: children.map((node) => mapNode(folder, node)),
      resourceUri: folder.uri,
      workspaceFolderId: folder.id,
      workspaceFolderRoot: true,
    };
  };

  const dataPort: DataPort = {
    listChildren: async (folderPath) => {
      if (folderPath === null) {
        if (workbench.folders.length === 1) {
          const folder = workbench.folders[0]!;
          const children = await requireProvider(folder).listChildren(null);
          return children.map((node) => mapNode(folder, node));
        }
        return Promise.all(workbench.folders.map(createRootNode));
      }
      const target = resolveResource(folderPath);
      const children = await requireProvider(target.folder).listChildren(target.providerPath);
      return children.map((node) => mapNode(target.folder, node));
    },
    resolveNode: async (path) => {
      const target = resolveResource(path);
      if (target.providerPath === null) return createRootNode(target.folder);
      const node = await requireProvider(target.folder).resolveNode?.(target.providerPath);
      return node ? mapNode(target.folder, node) : null;
    },
    previewServices: { database: { open: async (path, signal) => {
      const target = resolveResource(path);
      if (target.providerPath === null) throw new Error("invalid-request");
      const port = requireProvider(target.folder).previewServices?.database;
      if (!port) throw new Error("capability-unavailable");
      return port.open(target.providerPath, signal);
    } } },
    readFile: async (path, options) => {
      const target = resolveResource(path);
      if (target.providerPath === null) throw new Error("A Workspace Folder root is not a document.");
      const content = await requireProvider(target.folder).readFile?.(target.providerPath, options);
      if (!content) throw new Error("The selected file provider cannot read this document.");
      return mapContent(target.folder, content);
    },
    getFileUrl: async (path, options) => {
      const target = resolveResource(path);
      if (target.providerPath === null) throw new Error("A Workspace Folder root has no file URL.");
      const provider = requireProvider(target.folder);
      if (!provider.getFileUrl) throw new Error("The selected file provider cannot create a file URL.");
      const url = await provider.getFileUrl(target.providerPath, options);
      fileUrlOwners.set(url, provider);
      return url;
    },
    revokeFileUrl: async (url) => {
      const provider = fileUrlOwners.get(url);
      await provider?.revokeFileUrl?.(url);
      fileUrlOwners.delete(url);
    },
    openExternalFile: async (path) => {
      const target = resolveResource(path);
      if (target.providerPath === null) throw new Error("A Workspace Folder root is already open.");
      const provider = requireProvider(target.folder);
      if (!provider.openExternalFile) throw new Error("External open is unavailable for this provider.");
      await provider.openExternalFile(target.providerPath);
    },
    revealInFileManager: async (path) => {
      const target = resolveResource(path);
      if (target.providerPath === null) throw new Error("A Workspace Folder root is already visible in the Explorer.");
      const provider = requireProvider(target.folder);
      if (!provider.revealInFileManager) throw new Error("Reveal in file manager is unavailable for this provider.");
      await provider.revealInFileManager(target.providerPath);
    },
    convertOfficeDocumentToDocx: async (path, options) => {
      const target = resolveResource(path);
      if (target.providerPath === null) throw new Error("A Workspace Folder root is not an Office document.");
      const provider = requireProvider(target.folder);
      if (!provider.convertOfficeDocumentToDocx) throw new Error("Office conversion is unavailable for this provider.");
      return provider.convertOfficeDocumentToDocx(target.providerPath, options);
    },
    appPreview: createWorkbenchAppPreview(workbench, providers, resolveResource),
    documentPersistence: {
      kind: "local-fs",
      storageIdentity: `local-workbench:${workbench.id}`,
      persist: async (request) => {
        const target = resolveResource(request.path);
        if (target.providerPath === null) throw new Error("A Workspace Folder root cannot be persisted as a document.");
        const persistence = requireProvider(target.folder).documentPersistence;
        if (!persistence) throw new Error("Document persistence is unavailable for this provider.");
        return persistence.persist({ ...request, path: target.providerPath });
      },
    },
    createFolder: async (path) => {
      const target = resolveResource(path);
      if (target.providerPath === null) throw new Error("Cannot create a Workspace Folder inside itself.");
      const provider = requireProvider(target.folder);
      if (!provider.createFolder) throw new Error("Folder creation is unavailable for this provider.");
      await provider.createFolder(target.providerPath);
    },
    createFile: async (path, content) => {
      const target = resolveResource(path);
      if (target.providerPath === null) throw new Error("Cannot create a document at the Workspace Folder root URI.");
      const provider = requireProvider(target.folder);
      if (!provider.createFile) throw new Error("File creation is unavailable for this provider.");
      await provider.createFile(target.providerPath, content);
    },
    instantiateTemplate: async (request) => {
      const target = resolveResource(request.parentPath);
      const provider = requireProvider(target.folder);
      if (!provider.instantiateTemplate) throw new Error("Templates are unavailable for this provider.");
      return mapTemplateResult(target.folder, await provider.instantiateTemplate({
        ...request,
        parentPath: target.providerPath,
      }));
    },
    importFiles: async (files, targetFolderPath) => {
      const target = resolveResource(targetFolderPath);
      const provider = requireProvider(target.folder);
      if (!provider.importFiles) throw new Error("File import is unavailable for this provider.");
      const result = await provider.importFiles(files, target.providerPath);
      return {
        ...result,
        paths: result.paths.map((path) => toResourcePath(target.folder, path)),
      };
    },
    renameNode: async (path, nextName) => {
      const target = resolveResource(path);
      if (target.providerPath === null) throw new Error("Rename the Project from its Project settings.");
      const provider = requireProvider(target.folder);
      if (!provider.renameNode) throw new Error("Rename is unavailable for this provider.");
      await provider.renameNode(target.providerPath, nextName);
    },
    deleteNode: async (path) => {
      const target = resolveResource(path);
      if (target.providerPath === null) throw new Error("Remove the Project from the Workspace instead of deleting its root.");
      const provider = requireProvider(target.folder);
      if (!provider.deleteNode) throw new Error("Delete is unavailable for this provider.");
      await provider.deleteNode(target.providerPath);
    },
    moveNode: async (from, to) => {
      const source = resolveResource(from);
      const target = resolveResource(to);
      if (source.folder.id !== target.folder.id) {
        throw new Error("Move across Projects is unavailable. Copy the item, then delete the source.");
      }
      if (!source.providerPath || !target.providerPath) throw new Error("A Project root cannot be moved.");
      const provider = requireProvider(source.folder);
      if (!provider.moveNode) throw new Error("Move is unavailable for this provider.");
      await provider.moveNode(source.providerPath, target.providerPath);
    },
    copyNode: async (fromPath, targetFolderPath, options) => {
      const source = resolveResource(fromPath);
      const target = resolveResource(targetFolderPath);
      if (source.folder.id !== target.folder.id) {
        if (!source.providerPath) throw new Error("A Project root cannot be copied.");
        const result = await copyBetweenRoots({
          sourceRootPath: source.folder.workspace.path,
          targetRootPath: target.folder.workspace.path,
          fromPath: source.providerPath,
          targetFolderPath: target.providerPath,
          ...options,
        });
        return { ...result, path: toResourcePath(target.folder, result.path) };
      }
      if (!source.providerPath) throw new Error("A Project root cannot be copied.");
      const provider = requireProvider(source.folder);
      if (!provider.copyNode) throw new Error("Copy is unavailable for this provider.");
      const result = await provider.copyNode(source.providerPath, target.providerPath, options);
      return { ...result, path: toResourcePath(source.folder, result.path) };
    },
  };

  return Object.freeze({
    dataPort: Object.freeze(dataPort),
    rootResourcePaths: Object.freeze(workbench.folders.map((folder) => folder.uri)),
    resolveResource,
    tryResolveResource,
  });
}

function createWorkbenchAppPreview(
  workbench: WorkbenchWorkspace,
  providers: ReadonlyMap<string, DataPort>,
  resolveResource: (path: string | null) => ResolvedWorkbenchDataResource,
): AppPreviewController | undefined {
  if (!workbench.folders.every((folder) => providers.get(folder.id)?.appPreview)) return undefined;
  const resolve = (path: string) => {
    const target = resolveResource(path);
    if (!target.providerPath) throw new Error("A Workspace Folder root cannot be previewed as an App.");
    return { target, preview: providers.get(target.folder.id)!.appPreview! };
  };
  return {
    detect: (path) => {
      const { target, preview } = resolve(path);
      if (!preview.detect) throw new Error("App detection is unavailable for this provider.");
      return preview.detect(target.providerPath!);
    },
    configure: (request) => {
      const { target, preview } = resolve(request.path);
      if (!preview.configure) throw new Error("App configuration is unavailable for this provider.");
      return preview.configure({ ...request, path: target.providerPath! });
    },
    start: (path) => {
      const { target, preview } = resolve(path);
      return preview.start(target.providerPath!);
    },
    restart: (path) => {
      const { target, preview } = resolve(path);
      if (!preview.restart) throw new Error("App restart is unavailable for this provider.");
      return preview.restart(target.providerPath!);
    },
    stop: (path) => {
      const { target, preview } = resolve(path);
      if (!preview.stop) throw new Error("App stop is unavailable for this provider.");
      return preview.stop(target.providerPath!);
    },
    getLogs: (path) => {
      const { target, preview } = resolve(path);
      if (!preview.getLogs) throw new Error("App logs are unavailable for this provider.");
      return preview.getLogs(target.providerPath!);
    },
    openExternal: (path) => {
      const { target, preview } = resolve(path);
      if (!preview.openExternal) throw new Error("External App open is unavailable for this provider.");
      return preview.openExternal(target.providerPath!);
    },
    subscribeRuntime: (listener) => {
      const disposables = workbench.folders.flatMap((folder) => {
        const subscribe = providers.get(folder.id)!.appPreview!.subscribeRuntime;
        return subscribe ? [subscribe(listener)] : [];
      });
      return () => disposables.forEach((dispose) => dispose());
    },
  };
}
