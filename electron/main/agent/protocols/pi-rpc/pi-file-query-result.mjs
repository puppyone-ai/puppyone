import path from "node:path";

const PREVIEW_LIMIT = 32 * 1024;
const LINK_LIMIT = 80;

/** Pi find/ls print paths relative to the queried directory, followed by optional
 * blank-line-separated notices. Only complete file entries become navigation. */
export function piFileQueryResult(tool, args, output, failed = false) {
  if (tool !== "find" && tool !== "ls") return { outputPreview: output.slice(-PREVIEW_LIMIT) };
  // resultText already bounds individual text blocks; an exact budget may be a cut line.
  const truncated = output.length >= PREVIEW_LIMIT;
  const preview = output.slice(0, PREVIEW_LIMIT);
  if (failed) return { outputPreview: preview, outputPaths: [], truncated };
  if (preview === "No files found matching pattern" || preview === "(empty directory)") {
    return { outputPreview: preview, outputPaths: [], metadata: { resultCount: 0 }, truncated };
  }
  const base = typeof args?.path === "string" && args.path ? args.path : ".";
  const pathApi = /^(?:[a-z]:[\\/]|\\\\)/iu.test(base) ? path.win32 : path.posix;
  const outputPaths = [];
  let resultCount = 0;
  let notices = false;
  const lines = preview.split("\n");
  const formatted = lines.map((line, index) => {
    if (!line.trim()) { notices = true; return line; }
    if (notices || (truncated && index === lines.length - 1)) return line;
    // A newline, traversal or a URI is not a trustworthy native file entry.
    if (line.length > 4096 || line.includes("\0") || line.includes("\\") || line.includes(":")
      || pathApi.isAbsolute(line) || line.split("/").includes("..")) return line;
    resultCount += 1;
    const resolved = pathApi.join(base, line).split(pathApi.sep).join("/");
    if (!line.endsWith("/") && !base.startsWith("~") && outputPaths.length < LINK_LIMIT) outputPaths.push(resolved);
    return resolved;
  }).join("\n");
  return {
    outputPreview: formatted.slice(0, PREVIEW_LIMIT),
    outputPaths,
    metadata: { resultCount },
    truncated: truncated || formatted.length > PREVIEW_LIMIT,
  };
}
