import { createHash } from "node:crypto";
import { readFileSync, readdirSync, watch } from "node:fs";
import path from "node:path";

const STYLE_GRAPH_ASSET_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
]);

export function isInterfaceStyleGraphChange(eventType, fileName) {
  const changedFile = String(fileName ?? "");
  const extension = path.extname(changedFile).toLowerCase();

  if (extension === ".css") {
    return path.basename(changedFile) === "index.css" || eventType === "rename";
  }

  // Vite can retain a negative resolution result when CSS references an asset
  // that is created after the dev server starts. Content edits to an existing
  // asset still use normal HMR; additions, removals, and renames must rebuild
  // the renderer dependency graph so the URL is resolved instead of falling
  // through to the SPA document.
  return eventType === "rename" && STYLE_GRAPH_ASSET_EXTENSIONS.has(extension);
}

export function createInterfaceStyleGraphFingerprint(rootPath) {
  const graphEntries = [];
  collectGraphEntries(rootPath, "", graphEntries);
  return createHash("sha256").update(graphEntries.join("\0")).digest("hex");
}

export function watchInterfaceStyleGraph(
  rootPath,
  onGraphChange,
  watchImplementation = watch,
  {
    createFingerprint = createInterfaceStyleGraphFingerprint,
    settleDelayMs = 100,
  } = {},
) {
  let closed = false;
  let lastFingerprint = createFingerprint(rootPath);
  let pendingChange = null;
  let settleTimer = null;
  const watcher = watchImplementation(rootPath, { recursive: true }, (eventType, fileName) => {
    const changedFile = String(fileName ?? "");
    if (!isInterfaceStyleGraphChange(eventType, changedFile)) return;
    pendingChange = { eventType, fileName: changedFile };
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (closed || !pendingChange) return;
      const nextFingerprint = createFingerprint(rootPath);
      if (nextFingerprint === lastFingerprint) {
        pendingChange = null;
        return;
      }
      lastFingerprint = nextFingerprint;
      const change = pendingChange;
      pendingChange = null;
      onGraphChange(change);
    }, settleDelayMs);
  });

  return {
    close() {
      closed = true;
      pendingChange = null;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
      watcher.close();
    },
  };
}

function collectGraphEntries(directoryPath, relativeDirectory, graphEntries) {
  const entries = readdirSync(directoryPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      collectGraphEntries(absolutePath, relativePath, graphEntries);
      continue;
    }
    if (!entry.isFile()) continue;

    const extension = path.extname(entry.name).toLowerCase();
    if (extension !== ".css" && !STYLE_GRAPH_ASSET_EXTENSIONS.has(extension)) continue;
    const normalizedPath = relativePath.split(path.sep).join("/");
    graphEntries.push(`file:${normalizedPath}`);
    if (extension === ".css" && entry.name === "index.css") {
      graphEntries.push(`index:${normalizedPath}:${readFileSync(absolutePath, "utf8")}`);
    }
  }
}
