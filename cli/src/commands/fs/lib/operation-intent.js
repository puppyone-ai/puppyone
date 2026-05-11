import { ApiError } from "../../../api.js";
import { hasTrailingSlash, joinPath, scopedPath } from "./paths.js";

export function buildCopyMoveIntents(paths, options = {}, commandName = "operation") {
  const args = Array.isArray(paths) ? paths : [paths].filter(Boolean);
  const targetDirectoryPath = explicitTargetDirectoryPath(options);
  const usesTargetDirectory = targetDirectoryPath != null;

  if (!args.length || (!usesTargetDirectory && args.length < 2)) {
    throw new ApiError(
      0,
      "MISSING_OPERAND",
      `${commandName} requires at least a source and destination.`,
    );
  }

  const sources = usesTargetDirectory ? args : args.slice(0, -1);
  const destination = usesTargetDirectory ? targetDirectoryPath : args[args.length - 1];
  const noTargetDirectory = isNoTargetDirectory(options);

  if (noTargetDirectory && (usesTargetDirectory || sources.length > 1)) {
    throw new ApiError(
      0,
      "INVALID_TARGET",
      "-T cannot be used with multiple sources or --target-directory.",
    );
  }

  const targetDirectory = !noTargetDirectory
    && (usesTargetDirectory || sources.length > 1 || hasTrailingSlash(destination));

  return sources.map((source) => ({
    oldPath: scopedPath(source),
    newPath: scopedPath(destination),
    targetDirectory,
    noTargetDirectory,
  }));
}

export function explicitTargetDirectoryPath(options = {}) {
  return typeof options.targetDirectory === "string" ? options.targetDirectory : null;
}

export function isNoTargetDirectory(options = {}) {
  return options.noTargetDirectory === true || options.targetDirectory === false;
}

export function isNoClobber(options = {}) {
  return options.noClobber === true || options.clobber === false;
}

export async function resolveOverwritePromptPath(statPath, intent) {
  const dstStat = await statPath(intent.newPath);
  if (intent.targetDirectory) {
    if (!dstStat.exists || dstStat.type !== "folder") return null;
    const childPath = joinPath(intent.newPath, intent.oldPath);
    const childStat = await statPath(childPath);
    return childStat.exists ? childPath : null;
  }
  if (dstStat.exists && dstStat.type === "folder" && !intent.noTargetDirectory) {
    const childPath = joinPath(intent.newPath, intent.oldPath);
    const childStat = await statPath(childPath);
    return childStat.exists ? childPath : null;
  }
  return dstStat.exists ? intent.newPath : null;
}
