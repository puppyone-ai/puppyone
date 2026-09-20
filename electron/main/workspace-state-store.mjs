import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const WORKSPACE_REGISTRY_VERSION = 7;
const RECENT_WORKSPACE_LIMIT = 20;
const HYDRATION_CONCURRENCY = 4;

export function createWorkspaceStateStore({
  app,
  filename,
  canonicalizeWorkspacePath,
  workspaceFromPath,
  resolveWorkspaceIdentity = null,
  logger = console,
  fsApi = fs.promises,
  now = () => Date.now(),
}) {
  let mutationQueue = Promise.resolve();
  let recoveryError = null;

  async function getLastWorkspaceResult() {
    const composition = await readLastActiveWorkspaceComposition();
    const folderPath = composition.paths[0] ?? null;
    if (!folderPath) {
      return { workspaceId: null, path: null, workspace: null, workspaces: [], error: null };
    }

    try {
      const record = await readRecentWorkspaceRecord(folderPath);
      return {
        workspaceId: composition.workspaceId,
        path: folderPath,
        workspace: applyWorkspaceDisplayName(await workspaceFromPath(folderPath), record),
        error: null,
      };
    } catch (error) {
      return {
        workspaceId: composition.workspaceId,
        path: folderPath,
        workspace: null,
        error: `Unable to reopen last workspace (${folderPath}): ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async function getRecentWorkspacesResult() {
    const state = normalizeWorkspaceState(await readWorkspaceState());
    const items = state.recentWorkspaceRecords.map((record) => ({
      workspace: lightweightWorkspaceFromRecord(record),
      lastOpenedAt: record.lastOpenedAt,
    }));
    return {
      workspaces: items.map((item) => item.workspace),
      items,
      errors: recoveryError ? [recoveryError] : [],
      hydrated: false,
    };
  }

  async function hydrateRecentWorkspacesResult() {
    const state = normalizeWorkspaceState(await readWorkspaceState());
    const results = new Array(state.recentWorkspaceRecords.length);
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(HYDRATION_CONCURRENCY, state.recentWorkspaceRecords.length) },
      async () => {
        while (cursor < state.recentWorkspaceRecords.length) {
          const index = cursor;
          cursor += 1;
          const record = state.recentWorkspaceRecords[index];
          try {
            const workspace = applyWorkspaceDisplayName(
              await workspaceFromPath(record.path),
              record,
            );
            results[index] = {
              item: { workspace, lastOpenedAt: record.lastOpenedAt },
              error: null,
            };
          } catch (error) {
            results[index] = {
              item: {
                workspace: {
                  ...lightweightWorkspaceFromRecord(record),
                  hydrationState: "error",
                },
                lastOpenedAt: record.lastOpenedAt,
              },
              error: {
                path: record.path,
                error: error instanceof Error ? error.message : String(error),
              },
            };
          }
        }
      },
    );
    await Promise.all(workers);
    const items = results.filter(Boolean).map((result) => result.item);
    return {
      workspaces: items.map((item) => item.workspace),
      items,
      errors: [
        ...(recoveryError ? [recoveryError] : []),
        ...results.filter((result) => result?.error).map((result) => result.error),
      ],
      hydrated: true,
    };
  }

  async function readLastActiveWorkspacePath() {
    return (await readLastActiveWorkspacePaths())[0] ?? null;
  }

  async function readLastActiveWorkspacePaths() {
    return (await readLastActiveWorkspaceComposition()).paths;
  }

  function readLastActiveWorkspaceComposition() {
    return enqueueMutation(async () => {
      const state = normalizeWorkspaceState(await readWorkspaceState());
      const paths = state.lastActiveWorkspacePaths.map((folderPath) => path.resolve(folderPath));
      if (paths.length === 0) {
        return Object.freeze({ workspaceId: null, paths: Object.freeze([]) });
      }
      const workspaceId = state.lastActiveWorkbenchWorkspaceId ?? createPersistedWorkbenchWorkspaceId();
      if (!state.lastActiveWorkbenchWorkspaceId) {
        await writeWorkspaceState(createPersistedState(
          state.recentWorkspaceRecords,
          paths,
          workspaceId,
        ));
      }
      return Object.freeze({ workspaceId, paths: Object.freeze(paths) });
    });
  }

  async function rememberRecentWorkspacePath(folderPath, knownWorkspace = null, options = {}) {
    const canonicalPath = await canonicalizeWorkspacePath(folderPath);
    const identity = await resolveIdentity(canonicalPath, knownWorkspace);
    return enqueueMutation(async () => {
      const state = normalizeWorkspaceState(await readWorkspaceState());
      const previousRecord = state.recentWorkspaceRecords.find((item) => (
        isSameWorkspaceRecord(item, {
          workspaceInstanceId: identity.workspaceInstanceId,
          fsIdentity: identity.fsIdentity,
          path: canonicalPath,
        })
      ));
      const record = withPreservedDisplayName({
        workspaceInstanceId: identity.workspaceInstanceId,
        puppyoneGitRemote: normalizePuppyoneGitRemote(identity.puppyoneGitRemote),
        fsIdentity: identity.fsIdentity,
        path: canonicalPath,
        name: identity.name ?? (path.basename(canonicalPath) || canonicalPath),
        lastOpenedAt: new Date(now()).toISOString(),
      }, previousRecord);
      const recentWorkspaceRecords = [
        record,
        ...state.recentWorkspaceRecords.filter((item) => !isSameWorkspaceRecord(item, record)),
      ].slice(0, RECENT_WORKSPACE_LIMIT);
      await writeWorkspaceState(createPersistedState(
        recentWorkspaceRecords,
        [canonicalPath],
        normalizeOptionalString(options.workbenchWorkspaceId) ?? createPersistedWorkbenchWorkspaceId(),
      ));
      return record;
    });
  }

  async function rememberWorkspaceComposition(workspaces, options = {}) {
    if (!Array.isArray(workspaces) || workspaces.length === 0) {
      throw new TypeError("A Workspace composition requires at least one Folder.");
    }
    const compositionRecords = await Promise.all(workspaces.map(async (workspace) => {
      const canonicalPath = await canonicalizeRequiredPath(workspace?.path);
      const identity = await resolveIdentity(canonicalPath, workspace);
      return {
        workspaceInstanceId: identity.workspaceInstanceId,
        puppyoneGitRemote: normalizePuppyoneGitRemote(identity.puppyoneGitRemote),
        fsIdentity: identity.fsIdentity,
        path: canonicalPath,
        name: identity.name ?? (path.basename(canonicalPath) || canonicalPath),
        lastOpenedAt: new Date(now()).toISOString(),
      };
    }));

    return enqueueMutation(async () => {
      const state = normalizeWorkspaceState(await readWorkspaceState());
      const recordsWithDisplayNames = compositionRecords.map((record) => (
        withPreservedDisplayName(
          record,
          state.recentWorkspaceRecords.find((item) => isSameWorkspaceRecord(item, record)),
        )
      ));
      const recentWorkspaceRecords = [
        ...[...recordsWithDisplayNames].reverse(),
        ...state.recentWorkspaceRecords.filter(
          (record) => !recordsWithDisplayNames.some((activeRecord) => (
            isSameWorkspaceRecord(record, activeRecord)
          )),
        ),
      ].slice(0, RECENT_WORKSPACE_LIMIT);
      await writeWorkspaceState(createPersistedState(
        recentWorkspaceRecords,
        recordsWithDisplayNames.map((record) => record.path),
        normalizeOptionalString(options.workbenchWorkspaceId)
          ?? state.lastActiveWorkbenchWorkspaceId
          ?? createPersistedWorkbenchWorkspaceId(),
      ));
      return recordsWithDisplayNames;
    });
  }

  async function requireRecentWorkspacePath(folderPath) {
    const requestedPath = await canonicalizeRequiredPath(folderPath);
    const state = normalizeWorkspaceState(await readWorkspaceState());
    for (const record of state.recentWorkspaceRecords) {
      const persistedPath = await canonicalizeWorkspacePath(record.path);
      if (persistedPath === requestedPath) return persistedPath;
    }
    throw new Error("Workspace path is not in the main-process recent workspace list.");
  }

  async function removeRecentWorkspacePath(folderPath) {
    if (typeof folderPath !== "string" || !folderPath.trim()) {
      throw new Error("Workspace path is required.");
    }
    const requestedPath = path.resolve(folderPath.trim());
    let canonicalPath = null;
    try {
      canonicalPath = await canonicalizeWorkspacePath(requestedPath);
    } catch {
      // A stale registration must remain removable after its folder moved or
      // disappeared. The exact persisted path is still safe to forget.
    }
    return enqueueMutation(async () => {
      const state = normalizeWorkspaceState(await readWorkspaceState());
      const matchingRecord = state.recentWorkspaceRecords.find((item) => (
        item.path === requestedPath || (canonicalPath && item.path === canonicalPath)
      ));
      if (!matchingRecord) {
        throw new Error("Workspace path is not in the main-process recent workspace list.");
      }
      const recentWorkspaceRecords = state.recentWorkspaceRecords.filter((item) => item !== matchingRecord);
      const activeWorkspacePaths = state.lastActiveWorkspacePaths.filter((item) => item !== matchingRecord.path);
      await writeWorkspaceState(createPersistedState(recentWorkspaceRecords, activeWorkspacePaths));
      return { removed: true, path: matchingRecord.path };
    });
  }

  async function renameRecentWorkspacePath(folderPath, nextName) {
    const displayName = normalizeWorkspaceDisplayName(nextName);
    if (typeof folderPath !== "string" || !folderPath.trim()) {
      throw new Error("Workspace path is required.");
    }
    const requestedPath = path.resolve(folderPath.trim());
    let canonicalPath = null;
    try {
      canonicalPath = await canonicalizeWorkspacePath(requestedPath);
    } catch {
      // A stale registration remains renameable by its exact persisted path.
    }
    return enqueueMutation(async () => {
      const state = normalizeWorkspaceState(await readWorkspaceState());
      const recordIndex = state.recentWorkspaceRecords.findIndex((item) => (
        item.path === requestedPath || (canonicalPath && item.path === canonicalPath)
      ));
      if (recordIndex < 0) {
        throw new Error("Workspace path is not in the main-process recent workspace list.");
      }
      const current = state.recentWorkspaceRecords[recordIndex];
      const renamed = {
        ...current,
        ...(displayName === current.name ? {} : { displayName }),
      };
      if (displayName === current.name) delete renamed.displayName;
      const recentWorkspaceRecords = [...state.recentWorkspaceRecords];
      recentWorkspaceRecords[recordIndex] = renamed;
      await writeWorkspaceState(createPersistedState(
        recentWorkspaceRecords,
        state.lastActiveWorkspacePaths,
        state.lastActiveWorkbenchWorkspaceId,
      ));
      return { renamed: true, path: current.path, name: displayName };
    });
  }

  function clearActiveWorkspaceComposition(workbenchWorkspaceId) {
    return enqueueMutation(async () => {
      const state = normalizeWorkspaceState(await readWorkspaceState());
      if (state.lastActiveWorkbenchWorkspaceId !== workbenchWorkspaceId) return;
      await writeWorkspaceState(createPersistedState(state.recentWorkspaceRecords, [], workbenchWorkspaceId));
    });
  }

  function forgetLastWorkspacePath() {
    return enqueueMutation(async () => {
      await fsApi.rm(getWorkspaceStatePath(), { force: true });
      recoveryError = null;
    });
  }

  async function readWorkspaceState() {
    try {
      const raw = await fsApi.readFile(getWorkspaceStatePath(), "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Workspace registry root is invalid.");
      }
      return parsed;
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      const message = error instanceof Error ? error.message : String(error);
      logger.warn?.("Unable to read PuppyOne workspace registry; quarantining it.", message);
      const statePath = getWorkspaceStatePath();
      const quarantinePath = `${statePath}.corrupt.${now()}`;
      try {
        await fsApi.rename(statePath, quarantinePath);
        recoveryError = {
          path: statePath,
          error: `Workspace registry was corrupt and moved to ${path.basename(quarantinePath)}.`,
        };
      } catch (renameError) {
        if (renameError?.code !== "ENOENT") {
          recoveryError = { path: statePath, error: `Workspace registry is unreadable: ${message}` };
        }
      }
      return {};
    }
  }

  async function writeWorkspaceState(state) {
    const statePath = getWorkspaceStatePath();
    const directory = path.dirname(statePath);
    await fsApi.mkdir(directory, { recursive: true });
    const temporaryPath = path.join(
      directory,
      `.${path.basename(statePath)}.${process.pid}.${now()}.${Math.random().toString(16).slice(2)}.tmp`,
    );
    let handle = null;
    try {
      handle = await fsApi.open(temporaryPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await fsApi.rename(temporaryPath, statePath);
      await fsApi.chmod(statePath, 0o600).catch(() => undefined);
      await syncDirectoryBestEffort(directory, fsApi);
      recoveryError = null;
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await fsApi.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async function resolveIdentity(canonicalPath, knownWorkspace) {
    if (knownWorkspace?.workspaceInstanceId) {
      return {
        workspaceInstanceId: knownWorkspace.workspaceInstanceId,
        puppyoneGitRemote: normalizePuppyoneGitRemote(knownWorkspace.puppyoneGitRemote),
        fsIdentity: normalizeOptionalString(knownWorkspace.fsIdentity),
        name: normalizeOptionalString(knownWorkspace.name),
      };
    }
    if (resolveWorkspaceIdentity) {
      const identity = await resolveWorkspaceIdentity(canonicalPath);
      return {
        workspaceInstanceId: normalizeOptionalString(identity.workspaceInstanceId)
          ?? workspaceInstanceIdFromPath(canonicalPath),
        puppyoneGitRemote: normalizePuppyoneGitRemote(identity.puppyoneGitRemote),
        fsIdentity: normalizeOptionalString(identity.fsIdentity),
        name: path.basename(identity.canonicalPath ?? canonicalPath) || canonicalPath,
      };
    }
    const workspace = await workspaceFromPath(canonicalPath, { includeGitMetadata: false });
    return {
      workspaceInstanceId: normalizeOptionalString(workspace.workspaceInstanceId)
        ?? workspaceInstanceIdFromPath(canonicalPath),
      puppyoneGitRemote: normalizePuppyoneGitRemote(workspace.puppyoneGitRemote),
      fsIdentity: normalizeOptionalString(workspace.fsIdentity),
      name: normalizeOptionalString(workspace.name),
    };
  }

  async function canonicalizeRequiredPath(folderPath) {
    if (typeof folderPath !== "string" || !folderPath.trim()) {
      throw new Error("Folder path is required.");
    }
    return canonicalizeWorkspacePath(folderPath);
  }

  function enqueueMutation(operation) {
    const next = mutationQueue.then(operation, operation);
    mutationQueue = next.catch(() => undefined);
    return next;
  }

  function getWorkspaceStatePath() {
    return path.join(app.getPath("userData"), filename);
  }

  function readRecentWorkspaceRecord(folderPath) {
    return enqueueMutation(async () => {
      const state = normalizeWorkspaceState(await readWorkspaceState());
      const requestedPath = path.resolve(folderPath);
      return state.recentWorkspaceRecords.find((record) => record.path === requestedPath) ?? null;
    });
  }

  return {
    getLastWorkspaceResult,
    getRecentWorkspacesResult,
    hydrateRecentWorkspacesResult,
    readLastActiveWorkspacePath,
    readLastActiveWorkspacePaths,
    readLastActiveWorkspaceComposition,
    rememberWorkspaceComposition,
    clearActiveWorkspaceComposition,
    rememberRecentWorkspacePath,
    requireRecentWorkspacePath,
    removeRecentWorkspacePath,
    renameRecentWorkspacePath,
    forgetLastWorkspacePath,
  };
}

function normalizeWorkspaceState(state) {
  const records = [];
  const addRecord = (value, fallbackTimestamp = null) => {
    const record = normalizeWorkspaceRecord(value, fallbackTimestamp);
    if (!record) return;
    const existing = records.find((item) => isSameWorkspaceRecord(item, record));
    if (existing) {
      if (record.lastOpenedAt) existing.lastOpenedAt = record.lastOpenedAt;
      if (Object.hasOwn(record, "puppyoneGitRemote")) {
        existing.puppyoneGitRemote = record.puppyoneGitRemote;
      }
      if (record.fsIdentity) existing.fsIdentity = record.fsIdentity;
      if (record.displayName) existing.displayName = record.displayName;
      return;
    }
    records.push(record);
  };

  if (Array.isArray(state?.recentWorkspaces)) {
    for (const item of state.recentWorkspaces) addRecord(item);
  }
  if (Array.isArray(state?.recentWorkspacePaths)) {
    for (const item of state.recentWorkspacePaths) addRecord(item);
  }
  addRecord(state?.lastActiveWorkspacePath);
  addRecord(state?.lastWorkspacePath);

  return {
    version: WORKSPACE_REGISTRY_VERSION,
    lastActiveWorkbenchWorkspaceId: normalizeOptionalString(state?.lastActiveWorkbenchWorkspaceId),
    lastActiveWorkspacePaths: normalizeActiveWorkspacePaths(state, records),
    lastActiveWorkspacePath: normalizeOptionalString(state?.lastActiveWorkspacePath)
      ?? records[0]?.path
      ?? null,
    recentWorkspaceRecords: records.slice(0, RECENT_WORKSPACE_LIMIT),
  };
}

function normalizeWorkspaceRecord(value, fallbackTimestamp = null) {
  if (typeof value === "string") {
    const resolvedPath = path.resolve(value);
    return {
      workspaceInstanceId: workspaceInstanceIdFromPath(resolvedPath),
      fsIdentity: null,
      path: resolvedPath,
      name: path.basename(resolvedPath) || resolvedPath,
      lastOpenedAt: normalizeWorkspaceTimestamp(fallbackTimestamp),
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rawPath = normalizeOptionalString(value.path);
  if (!rawPath) return null;
  const resolvedPath = path.resolve(rawPath);
  return {
    workspaceInstanceId: normalizeOptionalString(value.workspaceInstanceId)
      ?? workspaceInstanceIdFromPath(resolvedPath),
    puppyoneGitRemote: normalizePuppyoneGitRemote(value.puppyoneGitRemote),
    fsIdentity: normalizeOptionalString(value.fsIdentity),
    path: resolvedPath,
    name: normalizeOptionalString(value.name) ?? (path.basename(resolvedPath) || resolvedPath),
    ...(normalizeOptionalString(value.displayName)
      ? { displayName: normalizeOptionalString(value.displayName) }
      : {}),
    lastOpenedAt: normalizeWorkspaceTimestamp(value.lastOpenedAt ?? fallbackTimestamp),
  };
}

function createPersistedState(records, activeWorkspacePaths = null, workbenchWorkspaceId = null) {
  const normalizedActivePaths = Array.isArray(activeWorkspacePaths)
    ? activeWorkspacePaths.map(normalizeOptionalString).filter(Boolean)
    : [records[0]?.path].filter(Boolean);
  const primaryRecord = records.find((record) => record.path === normalizedActivePaths[0]) ?? records[0];
  return {
    version: WORKSPACE_REGISTRY_VERSION,
    lastActiveWorkbenchWorkspaceId: normalizeOptionalString(workbenchWorkspaceId)
      ?? createPersistedWorkbenchWorkspaceId(),
    lastActiveWorkspaceInstanceId: primaryRecord?.workspaceInstanceId ?? null,
    lastActiveWorkspacePath: normalizedActivePaths[0] ?? null,
    lastActiveWorkspacePaths: normalizedActivePaths,
    // Keep the path array during the v1→v2 rollout for downgrade-safe reads.
    recentWorkspacePaths: records.map((record) => record.path),
    recentWorkspaces: records,
  };
}

function createPersistedWorkbenchWorkspaceId() {
  return `workbench:${crypto.randomUUID()}`;
}

function normalizeActiveWorkspacePaths(state, records) {
  const requestedPaths = Array.isArray(state?.lastActiveWorkspacePaths)
    ? state.lastActiveWorkspacePaths
    : [state?.lastActiveWorkspacePath, state?.lastWorkspacePath];
  const activePaths = [];
  for (const value of requestedPaths) {
    const folderPath = normalizeOptionalString(value);
    if (!folderPath) continue;
    const resolvedPath = path.resolve(folderPath);
    if (activePaths.includes(resolvedPath)) continue;
    activePaths.push(resolvedPath);
  }
  if (activePaths.length > 0 || Array.isArray(state?.lastActiveWorkspacePaths)) return activePaths;
  return records[0] ? [records[0].path] : [];
}

function lightweightWorkspaceFromRecord(record) {
  return {
    id: `local:${record.workspaceInstanceId}`,
    name: record.displayName ?? record.name,
    path: record.path,
    status: "protected",
    cloudState: "local",
    puppyoneGitRemote: record.puppyoneGitRemote,
    workspaceInstanceId: record.workspaceInstanceId,
    ...(record.fsIdentity ? { fsIdentity: record.fsIdentity } : {}),
    hydrationState: "metadata",
  };
}

function applyWorkspaceDisplayName(workspace, record) {
  return record?.displayName ? { ...workspace, name: record.displayName } : workspace;
}

function withPreservedDisplayName(record, previousRecord) {
  return previousRecord?.displayName
    ? {
        ...record,
        name: previousRecord.name,
        displayName: previousRecord.displayName,
      }
    : record;
}

function normalizeWorkspaceDisplayName(value) {
  if (typeof value !== "string") throw new TypeError("Project name is required.");
  const normalized = value.trim();
  if (!normalized) throw new Error("Project name is required.");
  if (normalized.length > 120) throw new Error("Project name must be 120 characters or fewer.");
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error("Project name contains unsupported characters.");
  }
  return normalized;
}

function isSameWorkspaceRecord(left, right) {
  if (left.workspaceInstanceId && right.workspaceInstanceId
    && left.workspaceInstanceId === right.workspaceInstanceId) return true;
  if (left.fsIdentity && right.fsIdentity && left.fsIdentity === right.fsIdentity) return true;
  return left.path === right.path;
}

function workspaceInstanceIdFromPath(folderPath) {
  return `legacy_${crypto.createHash("sha256").update(folderPath).digest("base64url").slice(0, 24)}`;
}

function normalizePuppyoneGitRemote(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const origin = normalizeOptionalString(value.origin);
  const projectId = normalizeOptionalString(value.projectId);
  const scopeId = normalizeOptionalString(value.scopeId);
  if (!origin || !projectId) return null;
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username || parsed.password || parsed.pathname !== '/'
      || parsed.search || parsed.hash) return null;
    return { origin: parsed.origin.toLowerCase(), projectId, scopeId };
  } catch {
    return null;
  }
}

async function syncDirectoryBestEffort(directory, fsApi) {
  let handle = null;
  try {
    handle = await fsApi.open(directory, "r");
    await handle.sync();
  } catch {
    // Directory fsync is unavailable on some platforms and filesystems.
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

function normalizeWorkspaceTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
