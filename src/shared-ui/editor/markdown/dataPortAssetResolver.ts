import type { DataPort } from "../../core/types";
import type { MarkdownAssetUrlResolver } from "../registry/viewerTypes";
import { acquireFileResource } from "../resource/FileResourcePool";
import { resolveMarkdownAssetPath } from "./assetResolution";

/** Resolves a document's relative media through its host's DataPort. */
export function createDataPortMarkdownAssetResolver(
  dataPort: DataPort,
  rootPath: string,
): MarkdownAssetUrlResolver {
  return async (sourcePath, href, signal) => {
    if (!dataPort.getFileUrl || signal?.aborted) return null;
    const assetPath = resolveMarkdownAssetPath(sourcePath, href, rootPath);
    if (!assetPath) return null;

    try {
      return await acquireFileResource(dataPort, assetPath, { purpose: "markdown-asset" }, signal);
    } catch {
      return null;
    }
  };
}
