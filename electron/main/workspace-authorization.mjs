import fs from "node:fs";
import path from "node:path";

/**
 * Creates the sole renderer Workspace Folder authorization capability. The
 * renderer may repeat an expected root, but it cannot mint authority: every
 * root comes from main-process window state and both sides are realpathed.
 *
 * `getWorkspaceRootForSender` remains as the single-folder compatibility
 * adapter. New window state supplies `getWorkspaceRootsForSender`.
 */
export function createSenderWorkspaceAuthorization({
  getWorkspaceRootForSender,
  getWorkspaceRootsForSender,
  fsModule = fs,
}) {
  if (
    typeof getWorkspaceRootsForSender !== "function"
    && typeof getWorkspaceRootForSender !== "function"
  ) {
    throw new TypeError("getWorkspaceRootsForSender is required.");
  }

  return async function authorizeWorkspaceRoot(event, requestedRoot = undefined) {
    const sender = event?.sender;
    if (!sender) {
      throw new Error("Workspace IPC sender is invalid.");
    }

    const assignedRoots = await resolveAssignedRoots({
      sender,
      getWorkspaceRootForSender,
      getWorkspaceRootsForSender,
    });
    if (assignedRoots.length === 0) {
      throw new Error("No local workspace is assigned to this window.");
    }

    // A folder that has gone from where it was must not take the window's other
    // folders down with it: only the folder a request names has to exist.
    const resolved = await Promise.allSettled(assignedRoots.map((assignedRoot) => (
      canonicalizeExistingDirectory(
        assignedRoot,
        "Unable to resolve a window Workspace Folder",
        fsModule,
      )
    )));
    const canonicalAssignedRoots = [...new Set(resolved
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value))];

    if (requestedRoot === undefined || requestedRoot === null) {
      if (assignedRoots.length === 1) {
        if (resolved[0].status === "rejected") throw resolved[0].reason;
        return canonicalAssignedRoots[0];
      }
      throw new Error("An explicit Workspace Folder root is required when multiple folders are attached.");
    }
    if (typeof requestedRoot !== "string" || requestedRoot.trim().length === 0) {
      throw new Error("Workspace root path must be a non-empty string.");
    }

    const canonicalRequestedRoot = await canonicalizeExistingDirectory(
      requestedRoot,
      "Unable to resolve the requested workspace root",
      fsModule,
    );
    const authorizedRoot = canonicalAssignedRoots.find(
      (assignedRoot) => path.relative(assignedRoot, canonicalRequestedRoot) === "",
    );
    if (!authorizedRoot) {
      throw new Error("Requested workspace root does not match the workspace assigned to this window.");
    }

    return authorizedRoot;
  };
}

async function resolveAssignedRoots({
  sender,
  getWorkspaceRootForSender,
  getWorkspaceRootsForSender,
}) {
  const value = typeof getWorkspaceRootsForSender === "function"
    ? await getWorkspaceRootsForSender(sender)
    : [await getWorkspaceRootForSender(sender)];
  if (!Array.isArray(value)) {
    throw new TypeError("Window Workspace Folder authority must be an array.");
  }
  return value.filter((root) => typeof root === "string" && root.trim().length > 0);
}

/** Resolve an existing working directory and prove its real path stays rooted. */
export async function resolveCanonicalWorkspaceDirectory(
  rootValue,
  directoryValue,
  { fsModule = fs, label = "Working directory" } = {},
) {
  const canonicalRoot = await canonicalizeExistingDirectory(
    rootValue,
    "Unable to resolve the workspace root",
    fsModule,
  );
  if (typeof directoryValue !== "string" || directoryValue.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  const candidate = path.isAbsolute(directoryValue)
    ? path.resolve(directoryValue)
    : path.resolve(canonicalRoot, directoryValue);
  const canonicalDirectory = await canonicalizeExistingDirectory(
    candidate,
    `Unable to resolve ${label.toLowerCase()}`,
    fsModule,
  );
  if (!isSameOrInsidePath(canonicalRoot, canonicalDirectory)) {
    throw new Error(`${label} must stay inside the assigned workspace.`);
  }
  return canonicalDirectory;
}

async function canonicalizeExistingDirectory(value, prefix, fsModule) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${prefix}: path is required.`);
  }
  const canonicalPath = await fsModule.promises.realpath(path.resolve(value)).catch((error) => {
    throw new Error(`${prefix}: ${error.message}`);
  });
  const metadata = await fsModule.promises.stat(canonicalPath).catch((error) => {
    throw new Error(`${prefix}: ${error.message}`);
  });
  if (!metadata.isDirectory()) {
    throw new Error(`${prefix}: path is not a directory.`);
  }
  return canonicalPath;
}

function isSameOrInsidePath(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
