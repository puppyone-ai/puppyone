import {
  canonicalizeResourcePath,
  type AiEditRequest,
  type DataNode,
  type DataNodeKind,
  type DataPort,
  type Workspace,
} from "@puppyone/shared-ui";
import type {
  CloudInitializationCleanupRequest,
  CloudInitializationIdentityRequest,
  CloudInitializationProgress,
  CloudInitializationResult,
  CloudInitializationStartRequest,
  CloudGitConnectAbandonRequest,
  CloudGitConnectRequest,
  CloudGitConnectResult,
  GitCommitDetail,
  GitBranchGraphSnapshot,
  GitRepositoryInvalidatedEvent,
  GitRepositoryWatchResult,
  GitStatusSnapshot,
  GitWorkingDiffScope,
  LastWorkspaceResult,
  PuppyoneWorkspaceConfig,
  RecentWorkspacesResult,
  WorkspaceCloneRepositoryRequest,
  WorkspaceCreateProjectRequest,
  WorkspaceCreateProjectResult,
  WorkspaceCreateEntryKind,
  WorkspaceCreateEntryResult,
  WorkspaceInstantiateTemplateResult,
  WorkspaceOpenEntryExternalRequest,
  WorkspaceImportEntriesResult,
  WorkspaceAttachResult,
  WorkspaceDetachResult,
  WorkspaceOpenResult,
  WorkspaceProjectLocationGrant,
} from "../types/electron";
import {
  createAppPreviewManifestContentFromSetup,
  detectAppPreviewSetup,
} from "../features/data-workspace/appPreviewCreation";
import { parseAppPreviewManifest } from "../../shared/appPreviewManifest.js";
import { createDatabasePreviewPort } from "../platform/databasePreviewClient";

export type { Workspace };
export type FileKind = DataNodeKind;
export type FileNode = DataNode;

let gitStatusRequestSequence = 0;

export function createLocalDocumentStorageIdentity(rootPath: string): string {
  return `local-fs:${rootPath.replace(/\/+$/, "") || "/"}`;
}

export function createLocalDataPort(rootPath: string): DataPort {
  return {
    previewServices: { database: createDatabasePreviewPort(rootPath, getDesktopBridge) },
    listChildren: (folderPath) => loadFolderChildren(rootPath, folderPath),
    resolveNode: (path) => getDesktopBridge().resolveNode({ rootPath, path }),
    // Text/content reads do not mint a browser capability URL. Resource URLs
    // have their own mounted-preview lifecycle and are revoked separately.
    readFile: async (path, options) => {
      options?.signal?.throwIfAborted();
      const result = await getDesktopBridge().readFile({ rootPath, path });
      options?.signal?.throwIfAborted();
      return result;
    },
    getFileUrl: (path, options) => getDesktopBridge()
      .getFileUrl({ rootPath, path, purpose: options?.purpose ?? "file-preview", expectedVersion: options?.expectedVersion })
      .then((result) => result.url),
    revokeFileUrl: (url) => getDesktopBridge()
      .revokeFileUrl({ url })
      .then(() => undefined),
    openExternalFile: (path) => getDesktopBridge().openEntryExternal({ rootPath, path }).then(() => undefined),
    revealInFileManager: (path) => getDesktopBridge().revealEntryInFinder({ rootPath, path }).then(() => undefined),
    convertOfficeDocumentToDocx: async (path, options) => {
      const signal = options?.signal;
      if (signal?.aborted) throw createOfficeConversionAbortError();

      const bridge = getDesktopBridge();
      const requestId = createOfficeConversionRequestId();
      const cancel = () => {
        try {
          void bridge.cancelOfficeDocumentToDocxConversion({ requestId }).catch(() => {});
        } catch {
          // The conversion request may already have completed or the window may be closing.
        }
      };
      signal?.addEventListener("abort", cancel, { once: true });

      try {
        const result = await bridge.convertOfficeDocumentToDocx({ rootPath, path, requestId });
        if (signal?.aborted) throw createOfficeConversionAbortError();
        return {
          arrayBuffer: toArrayBuffer(result.bytes),
          warnings: result.warnings,
        };
      } catch (error) {
        if (signal?.aborted) throw createOfficeConversionAbortError();
        throw error;
      } finally {
        signal?.removeEventListener("abort", cancel);
      }
    },
    appPreview: {
      detect: (path) => detectAppPreviewSetup({
        listChildren: (folderPath) => loadFolderChildren(rootPath, folderPath),
        readFile: async (filePath, readOptions) => {
          readOptions?.signal?.throwIfAborted();
          const result = await getDesktopBridge().readFile({ rootPath, path: filePath });
          readOptions?.signal?.throwIfAborted();
          return result;
        },
      }, path),
      configure: async ({ path, name, setup, expectedContent }) => {
        const current = await getDesktopBridge().readFile({ rootPath, path });
        if ((current.content ?? "") !== expectedContent) {
          throw new Error("This App changed while setup was open. Review the latest version and try again.");
        }
        const content = createAppPreviewManifestContentFromSetup(name, setup);
        const manifest = parseAppPreviewManifest(content, { appPath: path });
        if (manifest.launch) await preflightAppPreviewLaunch(rootPath, path, manifest.launch);
        const result = await getDesktopBridge().writeFile({
          rootPath,
          path,
          content,
          expectedVersion: current.version ?? null,
        });
        const success = requireWorkspaceWriteSuccess(result);
        return { content, version: success.version };
      },
      start: (path) => getDesktopBridge().startAppPreview({ rootPath, path }),
      restart: (path) => getDesktopBridge().restartAppPreview({ rootPath, path }),
      stop: (path) => getDesktopBridge().stopAppPreview({ rootPath, path }),
      getLogs: (path) => getDesktopBridge().getAppPreviewLogs({ rootPath, path }),
      openExternal: (path) => getDesktopBridge().openAppPreviewExternal({ rootPath, path }).then(() => undefined),
      subscribeRuntime: (listener) => getDesktopBridge().onAppPreviewRuntimeState((state) => {
        if (state.rootPath === rootPath) listener(state);
      }),
    },
    documentPersistence: {
      kind: "local-fs",
      storageIdentity: createLocalDocumentStorageIdentity(rootPath),
      persist: ({ path, content, baseVersion }) => getDesktopBridge().writeFile({
        rootPath,
        path: canonicalizeResourcePath(path),
        content,
        expectedVersion: baseVersion ?? null,
      }),
    },
    createFolder: (path) => {
      const { parentPath, name } = splitDataPath(path);
      return getDesktopBridge().createEntry({ rootPath, parentPath, name, kind: "folder" }).then(() => undefined);
    },
    createFile: (path, content = "") => {
      const { parentPath, name } = splitDataPath(path);
      return getDesktopBridge().createEntry({ rootPath, parentPath, name, kind: "file", content }).then(() => undefined);
    },
    instantiateTemplate: ({ templateId, parentPath, name }) => getDesktopBridge().instantiateTemplate({
      rootPath,
      templateId,
      parentPath,
      name,
    }),
    importFiles: (files, targetFolderPath) => importWorkspaceFiles(rootPath, targetFolderPath, files),
    renameNode: (path, nextName) => getDesktopBridge().renameEntry({ rootPath, path, nextName }).then(() => undefined),
    moveNode: (from, to) => getDesktopBridge().moveEntry({ rootPath, fromPath: from, toPath: to }).then(() => undefined),
    copyNode: (fromPath, targetFolderPath, options) => getDesktopBridge().copyEntry({
      rootPath,
      fromPath,
      targetFolderPath,
      ...options,
    }),
    deleteNode: (path) => getDesktopBridge().deleteEntry({ rootPath, path }).then(() => undefined),
  };
}

function requireWorkspaceWriteSuccess(
  result: Awaited<ReturnType<ReturnType<typeof getDesktopBridge>["writeFile"]>>,
): Extract<typeof result, { ok: true }> {
  if (result.ok) return result;
  if (result.kind === "conflict") {
    throw new Error("This file changed while the operation was in progress.");
  }
  throw new Error(result.message);
}

async function preflightAppPreviewLaunch(
  rootPath: string,
  appPath: string,
  launch: NonNullable<ReturnType<typeof parseAppPreviewManifest>["launch"]>,
): Promise<void> {
  const appDirectory = getDataParentPath(appPath);
  if (launch.kind === "existing-url") return;
  if (launch.kind === "static-file") {
    const htmlPath = joinDataPaths(appDirectory, launch.path);
    await getDesktopBridge().readFile({ rootPath, path: htmlPath }).catch(() => {
      throw new Error(`HTML file not found: ${launch.path}`);
    });
    return;
  }

  const workingDirectory = joinDataPaths(appDirectory, launch.cwd);
  const children = await loadFolderChildren(rootPath, workingDirectory || null).catch(() => {
    throw new Error(`Working folder not found: ${launch.cwd}`);
  });
  const packageScript = getPackageScriptFromCommand(launch.command);
  if (!packageScript) return;
  const packageNode = children.find((node) => node.type !== "folder" && node.name === "package.json");
  if (!packageNode) throw new Error(`No package.json was found in ${launch.cwd}.`);
  const packageFile = await getDesktopBridge().readFile({ rootPath, path: packageNode.path });
  let scripts: unknown;
  try {
    scripts = JSON.parse(packageFile.content ?? "")?.scripts;
  } catch {
    throw new Error(`package.json in ${launch.cwd} is not valid JSON.`);
  }
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts) || typeof (scripts as Record<string, unknown>)[packageScript] !== "string") {
    throw new Error(`Package script not found: ${packageScript}`);
  }
}

function getPackageScriptFromCommand(command: readonly string[]): string | null {
  const executable = command[0]?.split(/[\\/]/).at(-1)?.toLowerCase().replace(/\.cmd$/, "");
  if (!executable || !new Set(["npm", "pnpm", "yarn", "bun"]).has(executable)) return null;
  // Only the explicit `run` form is unambiguously a package script. Advanced
  // commands such as `npm exec`, `pnpm dlx`, or `yarn install` must not be
  // mistaken for script names and rejected before the runtime can execute them.
  if (command[1] !== "run") return null;
  const script = command[2];
  return script && !script.startsWith("-") ? script : null;
}

function getDataParentPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex < 0 ? null : normalized.slice(0, slashIndex) || null;
}

function joinDataPaths(base: string | null, relative: string): string {
  const parts = [base, relative].filter((value): value is string => Boolean(value && value !== "."));
  return parts.join("/");
}

export async function loadFolderChildren(rootPath: string, folderPath: string | null): Promise<FileNode[]> {
  return getDesktopBridge().listFolderChildren({
    rootPath,
    folderPath,
  });
}

function splitDataPath(path: string): { parentPath: string | null; name: string } {
  const normalizedPath = path.replace(/^\/+|\/+$/g, "");
  const slashIndex = normalizedPath.lastIndexOf("/");
  if (slashIndex < 0) {
    return { parentPath: null, name: normalizedPath };
  }
  return {
    parentPath: normalizedPath.slice(0, slashIndex) || null,
    name: normalizedPath.slice(slashIndex + 1),
  };
}

export async function getLastWorkspace(): Promise<LastWorkspaceResult> {
  return getDesktopBridge().getLastWorkspace();
}

export async function getInitialWorkspace(): Promise<LastWorkspaceResult> {
  return getDesktopBridge().getInitialWorkspace();
}

export async function getRecentWorkspaces(): Promise<RecentWorkspacesResult> {
  return getDesktopBridge().getRecentWorkspaces();
}

export async function hydrateRecentWorkspaces(): Promise<RecentWorkspacesResult> {
  return getDesktopBridge().hydrateRecentWorkspaces();
}

export async function removeRecentWorkspace(folderPath: string): Promise<void> {
  await getDesktopBridge().removeRecentWorkspace(folderPath);
}

export async function openExternalUrl(href: string): Promise<void> {
  await getDesktopBridge().openExternalUrl(href);
}

export async function revealWorkspaceEntryInFinder(rootPath: string, path: string): Promise<void> {
  await getDesktopBridge().revealEntryInFinder({ rootPath, path });
}

export async function openWorkspaceEntryExternal(
  request: WorkspaceOpenEntryExternalRequest,
): Promise<{ ok: boolean; cancelled?: boolean }> {
  return getDesktopBridge().openEntryExternal(request);
}

export async function forgetLastWorkspace(): Promise<void> {
  await getDesktopBridge().forgetLastWorkspace();
}

export async function showHomepage(): Promise<void> {
  await getDesktopBridge().showHomepage();
}

export async function openWorkspaceInCurrentWindow(folderPath: string): Promise<WorkspaceOpenResult> {
  return getDesktopBridge().openWorkspaceInCurrentWindow(folderPath);
}

export async function openWorkspaceInNewWindow(folderPath: string): Promise<WorkspaceOpenResult> {
  return getDesktopBridge().openWorkspaceInNewWindow(folderPath);
}

export async function openDroppedWorkspaceInCurrentWindow(folder: File): Promise<WorkspaceOpenResult> {
  return getDesktopBridge().openDroppedWorkspaceInCurrentWindow(folder);
}

export async function selectWorkspaceFolder(): Promise<WorkspaceOpenResult | null> {
  return getDesktopBridge().selectFolder();
}

export async function selectWorkspaceFolderToAttach(): Promise<WorkspaceAttachResult | null> {
  return getDesktopBridge().selectFolderToAttach();
}

export async function attachWorkspaceFolder(folderPath: string): Promise<WorkspaceAttachResult> {
  return getDesktopBridge().attachFolder(folderPath);
}

export async function detachWorkspaceFolder(folderPath: string): Promise<WorkspaceDetachResult> {
  return getDesktopBridge().detachFolder(folderPath);
}

export async function copyWorkspaceEntryBetweenRoots(request: {
  sourceRootPath: string;
  targetRootPath: string;
  fromPath: string;
  targetFolderPath: string | null;
  preferredName?: string;
  forceDuplicateName?: boolean;
}): Promise<{ path: string }> {
  return getDesktopBridge().copyEntryBetweenRoots(request);
}

export async function selectWorkspaceFolderInNewWindow(): Promise<WorkspaceOpenResult | null> {
  return getDesktopBridge().selectFolderInNewWindow();
}

export async function createLocalProject(
  request: WorkspaceCreateProjectRequest,
): Promise<WorkspaceCreateProjectResult> {
  return getDesktopBridge().createLocalProject(request);
}

export async function selectLocalProjectLocation(): Promise<WorkspaceProjectLocationGrant | null> {
  return getDesktopBridge().selectLocalProjectLocation();
}

export async function getDefaultLocalProjectLocation(): Promise<WorkspaceProjectLocationGrant | null> {
  return getDesktopBridge().getDefaultLocalProjectLocation();
}

export async function cloneRepository(
  request: WorkspaceCloneRepositoryRequest,
): Promise<WorkspaceOpenResult | null> {
  return getDesktopBridge().cloneRepository(request);
}

export async function createWorkspaceEntry(
  rootPath: string,
  request: {
    parentPath: string | null;
    name: string;
    kind: WorkspaceCreateEntryKind;
    content?: string;
  },
): Promise<WorkspaceCreateEntryResult> {
  return getDesktopBridge().createEntry({ rootPath, ...request });
}

export async function instantiateWorkspaceTemplate(
  rootPath: string,
  request: {
    parentPath: string | null;
    name: string;
    templateId: "slides.default";
  },
): Promise<WorkspaceInstantiateTemplateResult> {
  return getDesktopBridge().instantiateTemplate({ rootPath, ...request });
}

export async function importWorkspaceFiles(
  rootPath: string,
  targetFolderPath: string | null,
  files: File[],
): Promise<WorkspaceImportEntriesResult> {
  return getDesktopBridge().importEntries({
    rootPath,
    targetFolderPath,
    files,
  });
}

export async function getLatestAiEditReviewRequest(rootPath: string): Promise<AiEditRequest | null> {
  return getDesktopBridge().getLatestAiEditReviewRequest({ rootPath });
}

export function subscribeAiEditReviewUpdates(
  callback: (event: { rootPath: string; request: AiEditRequest }) => void,
): () => void {
  return getDesktopBridge().onAiEditReviewUpdated(callback);
}

export async function getWorkspaceGitStatus(
  rootPath: string,
  options: { signal?: AbortSignal } = {},
): Promise<GitStatusSnapshot> {
  const { signal } = options;
  if (signal?.aborted) throw createGitStatusAbortError();

  const bridge = getDesktopBridge();
  const requestId = `git-status-${Date.now().toString(36)}-${(gitStatusRequestSequence += 1).toString(36)}`;
  const cancel = () => {
    if (typeof bridge.cancelGitStatus === "function") {
      void bridge.cancelGitStatus({ requestId }).catch(() => {});
    }
  };
  signal?.addEventListener("abort", cancel, { once: true });

  try {
    return await bridge.getGitStatus({ rootPath, requestId });
  } catch (error) {
    if (signal?.aborted) throw createGitStatusAbortError();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export async function getWorkspaceCloudInitializationState(
  request: CloudInitializationIdentityRequest,
): Promise<CloudInitializationResult> {
  return getDesktopBridge().cloudInitializationGetState(request);
}

export async function startWorkspaceCloudInitialization(
  request: CloudInitializationStartRequest,
): Promise<CloudInitializationResult> {
  return getDesktopBridge().cloudInitializationStart(request);
}

export async function cleanupWorkspaceCloudInitialization(
  request: CloudInitializationCleanupRequest,
): Promise<CloudInitializationResult> {
  return getDesktopBridge().cloudInitializationCleanup(request);
}

export function subscribeWorkspaceCloudInitializationProgress(
  callback: (progress: CloudInitializationProgress) => void,
): () => void {
  return getDesktopBridge().onCloudInitializationProgress(callback);
}

export async function connectWorkspaceCloudProject(
  request: CloudGitConnectRequest,
): Promise<CloudGitConnectResult> {
  return getDesktopBridge().cloudGitConnectProject(request);
}

export async function abandonWorkspaceCloudProjectConnection(
  request: CloudGitConnectAbandonRequest,
): Promise<CloudGitConnectResult> {
  return getDesktopBridge().cloudGitAbandonConnect(request);
}

function createGitStatusAbortError(): DOMException {
  return new DOMException("Git status request was cancelled.", "AbortError");
}

export async function startWorkspaceGitRepositoryWatch(
  rootPath: string,
): Promise<GitRepositoryWatchResult | null> {
  const bridge = getDesktopBridge();
  if (typeof bridge.startGitRepositoryWatch !== "function") return null;
  return bridge.startGitRepositoryWatch({ rootPath });
}

export async function stopWorkspaceGitRepositoryWatch(subscriptionId: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (typeof bridge.stopGitRepositoryWatch !== "function") return;
  await bridge.stopGitRepositoryWatch({ subscriptionId }).catch(() => {});
}

export function subscribeWorkspaceGitRepositoryInvalidations(
  callback: (event: GitRepositoryInvalidatedEvent) => void,
): () => void {
  const bridge = getDesktopBridge();
  if (typeof bridge.onGitRepositoryInvalidated !== "function") return () => {};
  return bridge.onGitRepositoryInvalidated(callback);
}

export async function getWorkspaceGitBranchGraph(
  rootPath: string,
  options: { requestId?: string } = {},
): Promise<GitBranchGraphSnapshot> {
  const bridge = getDesktopBridge();
  if (typeof bridge.getGitBranchGraph === "function") {
    try {
      return await bridge.getGitBranchGraph({
        rootPath,
        requestId: options.requestId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/No handler registered.*workspace:git-branch-graph|workspace:git-branch-graph/i.test(message)) {
        throw error;
      }
    }
  }
  const status = await bridge.getGitStatus({ rootPath });
  return toWorkspaceGitBranchGraphSnapshot(status);
}

export async function cancelWorkspaceGitBranchGraph(requestId: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (typeof bridge.cancelGitBranchGraph !== "function") return;
  await bridge.cancelGitBranchGraph({ requestId }).catch(() => {});
}

export function toWorkspaceGitBranchGraphSnapshot(status: GitStatusSnapshot | GitBranchGraphSnapshot): GitBranchGraphSnapshot {
  return {
    isRepo: status.isRepo,
    branch: status.branch,
    headCommitId: status.headCommitId,
    branches: status.branches,
    commits: status.commits,
    allCommits: status.allCommits,
  };
}

export async function initializeWorkspaceGitRepository(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().initGitRepository({ rootPath });
}

export async function removeWorkspaceGitRemote(
  rootPath: string,
  remoteName = "puppyone",
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().removeGitRemote({ rootPath, remoteName });
}

export async function readPuppyoneWorkspaceConfig(rootPath: string): Promise<PuppyoneWorkspaceConfig> {
  return getDesktopBridge().readPuppyoneConfig({ rootPath });
}

export async function writePuppyoneWorkspaceConfig(
  rootPath: string,
  config: PuppyoneWorkspaceConfig,
): Promise<PuppyoneWorkspaceConfig> {
  return getDesktopBridge().writePuppyoneConfig({ rootPath, config });
}

export async function getWorkspaceGitCommitDetail(rootPath: string, commitId: string): Promise<GitCommitDetail> {
  return getDesktopBridge().getGitCommitDetail({ rootPath, commitId });
}

export async function getWorkspaceGitFileDiff(
  rootPath: string,
  path: string,
  scope: GitWorkingDiffScope,
  options: { requestId?: string; sessionId?: string } = {},
): Promise<GitCommitDetail> {
  return getDesktopBridge().getGitFileDiff({ rootPath, path, scope, ...options });
}

export async function cancelWorkspaceGitFileDiff(requestId: string, sessionId: string): Promise<void> {
  await getDesktopBridge().cancelGitFileDiff?.({ requestId, sessionId });
}

export async function readWorkspaceGitDiffResource(request: {
  handle: string;
  size: number;
  sessionId: string;
  selectionIdentity: string;
  revisionIdentity: string;
}, signal?: AbortSignal): Promise<ArrayBuffer> {
  const maxResourceBytes = 25 * 1024 * 1024;
  const readChunkBytes = 4 * 1024 * 1024;
  if (
    !Number.isSafeInteger(request.size)
    || request.size < 0
    || request.size > maxResourceBytes
  ) {
    throw new Error("Git diff resource has an invalid or unsupported size.");
  }

  throwIfGitDiffResourceReadAborted(signal);
  const bytes = new Uint8Array(request.size);
  let offset = 0;
  while (offset < request.size) {
    throwIfGitDiffResourceReadAborted(signal);
    const requestedLength = Math.min(readChunkBytes, request.size - offset);
    const result = await getDesktopBridge().readGitDiffResource({
      handle: request.handle,
      sessionId: request.sessionId,
      selectionIdentity: request.selectionIdentity,
      revisionIdentity: request.revisionIdentity,
      offset,
      length: requestedLength,
    });
    throwIfGitDiffResourceReadAborted(signal);

    const expectedLength = Math.min(requestedLength, request.size - offset);
    const expectedDone = offset + expectedLength === request.size;
    if (
      result.selectionIdentity !== request.selectionIdentity
      || result.revisionIdentity !== request.revisionIdentity
      || result.offset !== offset
      || result.size !== request.size
      || !(result.bytes instanceof Uint8Array)
      || result.bytes.byteLength !== expectedLength
      || result.done !== expectedDone
    ) {
      throw new Error("Git diff resource identity or range changed while loading.");
    }
    bytes.set(result.bytes, offset);
    offset += result.bytes.byteLength;
  }
  return bytes.buffer;
}

function throwIfGitDiffResourceReadAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Git diff resource read was cancelled.");
  error.name = "AbortError";
  throw error;
}

export async function releaseWorkspaceGitDiffResources(sessionId: string): Promise<void> {
  await getDesktopBridge().releaseGitDiffResources({ sessionId });
}

export async function stageWorkspaceGitPaths(rootPath: string, paths: string[]): Promise<GitStatusSnapshot> {
  return getDesktopBridge().stageGitPaths({ rootPath, paths });
}

export async function stageAllWorkspaceGitChanges(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().stageAllGitChanges({ rootPath });
}

export async function unstageWorkspaceGitPaths(rootPath: string, paths: string[]): Promise<GitStatusSnapshot> {
  return getDesktopBridge().unstageGitPaths({ rootPath, paths });
}

export async function unstageAllWorkspaceGitChanges(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().unstageAllGitChanges({ rootPath });
}

export async function discardWorkspaceGitPaths(rootPath: string, paths: string[]): Promise<GitStatusSnapshot> {
  return getDesktopBridge().discardGitPaths({ rootPath, paths });
}

export async function discardAllWorkspaceGitChanges(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().discardAllGitChanges({ rootPath });
}

export async function commitWorkspaceGit(
  rootPath: string,
  message: string,
  options: { allowEmpty?: boolean; authorName?: string; authorEmail?: string } = {},
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().commitGit({
    rootPath,
    message,
    ...(options.allowEmpty ? { allowEmpty: true } : {}),
    ...(options.authorName ? { authorName: options.authorName } : {}),
    ...(options.authorEmail ? { authorEmail: options.authorEmail } : {}),
  });
}

export async function stashWorkspaceGitChanges(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().stashGitChanges({ rootPath });
}

export async function continueWorkspaceGitOperation(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().continueGitOperation({ rootPath });
}

export async function abortWorkspaceGitOperation(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().abortGitOperation({ rootPath });
}

export async function checkoutWorkspaceGitBranch(
  rootPath: string,
  branchName: string,
  remote: boolean,
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().checkoutGitBranch({ rootPath, branchName, remote });
}

export async function stashAndCheckoutWorkspaceGitBranch(
  rootPath: string,
  branchName: string,
  remote: boolean,
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().stashAndCheckoutGitBranch({ rootPath, branchName, remote });
}

export async function commitAndCheckoutWorkspaceGitBranch(
  rootPath: string,
  branchName: string,
  remote: boolean,
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().commitAndCheckoutGitBranch({ rootPath, branchName, remote });
}

export async function createWorkspaceGitBranch(rootPath: string, branchName: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().createGitBranch({ rootPath, branchName });
}

export async function fetchWorkspaceGit(
  rootPath: string,
  options: { remoteName?: string | null } = {},
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().fetchGit({ rootPath, remoteName: options.remoteName ?? undefined });
}

export async function pullWorkspaceGit(
  rootPath: string,
  options: { showNativeErrorDialog?: boolean } = {},
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().pullGit({ rootPath, showNativeErrorDialog: options.showNativeErrorDialog });
}

export async function pushWorkspaceGit(
  rootPath: string,
  options: { showNativeErrorDialog?: boolean } = {},
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().pushGit({ rootPath, showNativeErrorDialog: options.showNativeErrorDialog });
}

export async function pushWorkspaceGitCommitToRemote(
  rootPath: string,
  request: {
    remoteName: string;
    destinationBranch: string;
    expectedHeadCommitId: string;
    expectedBranch: string;
  },
): Promise<GitStatusSnapshot> {
  return getDesktopBridge().pushGitCommitToRemote({ rootPath, ...request });
}

export async function publishWorkspaceGitBranch(rootPath: string, remoteName?: string | null): Promise<GitStatusSnapshot> {
  return getDesktopBridge().publishGitBranch({ rootPath, remoteName });
}

export async function syncWorkspaceGit(rootPath: string): Promise<GitStatusSnapshot> {
  return getDesktopBridge().syncGit({ rootPath });
}

export function findFileNode(nodes: FileNode[], path: string | null): FileNode | null {
  if (!path) return null;

  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const child = findFileNode(node.children, path);
      if (child) return child;
    }
  }

  return null;
}

export function listFolderChildren(nodes: FileNode[], folderPath: string | null): FileNode[] {
  if (!folderPath) return nodes;
  return findFileNode(nodes, folderPath)?.children ?? [];
}

export function hasLoadedFolder(nodes: FileNode[], folderPath: string | null): boolean {
  if (!folderPath) return nodes.length > 0;
  const node = findFileNode(nodes, folderPath);
  return node?.type === "folder" && Array.isArray(node.children);
}

export function attachFolderChildren(
  nodes: FileNode[],
  folderPath: string | null,
  children: FileNode[],
): FileNode[] {
  if (!folderPath) return children;

  return nodes.map((node) => {
    if (node.path === folderPath) {
      return { ...node, children };
    }
    if (node.children) {
      return {
        ...node,
        children: attachFolderChildren(node.children, folderPath, children),
      };
    }
    return node;
  });
}

function getDesktopBridge() {
  if (!window.puppyoneDesktop) {
    throw new Error("puppyone desktop bridge is unavailable. Run the app with Electron.");
  }
  return window.puppyoneDesktop;
}

let officeConversionRequestSequence = 0;

function createOfficeConversionRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  officeConversionRequestSequence += 1;
  return `office-${Date.now().toString(36)}-${officeConversionRequestSequence.toString(36)}`;
}

function createOfficeConversionAbortError(): Error {
  const error = new Error("Office conversion was cancelled.");
  error.name = "AbortError";
  return error;
}

function toArrayBuffer(bytes: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return copy.buffer;
}
