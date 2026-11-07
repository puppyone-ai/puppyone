import path from "node:path";

const ACTIVITY_EVENT_TYPES = new Set([
  "tool.started",
  "tool.progress",
  "tool.completed",
  "file.change.updated",
  "provider.activity",
]);
const PATH_KEYS = ["path", "file", "filepath", "file_path", "filePath"];

/**
 * Runtime harnesses may report absolute host paths while the public Agent
 * event contract is workspace-relative. Normalize that protocol difference at
 * the Main-owned session boundary so Renderer projections and persisted replay
 * records never need to infer filesystem identity.
 */
export function normalizeAgentEventWorkspacePaths(event, workspaceRoot, pathApi = path) {
  if (!event || typeof event !== "object" || !ACTIVITY_EVENT_TYPES.has(event.type)) return event;
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return event;
  if (typeof workspaceRoot !== "string" || !pathApi.isAbsolute(workspaceRoot)) return event;

  const replacements = new Map();
  const payload = normalizeActivityPayload(event.payload, workspaceRoot, pathApi, replacements);
  for (const key of ["label", "title", "summary"]) {
    if (typeof payload[key] !== "string") continue;
    payload[key] = replacePathMentions(payload[key], replacements);
  }
  return { ...event, payload };
}

export function normalizeAgentWorkspaceEventPath(workspaceRoot, candidate, pathApi = path) {
  if (typeof workspaceRoot !== "string" || !pathApi.isAbsolute(workspaceRoot)) return null;
  if (typeof candidate !== "string" || !candidate.trim() || candidate.includes("://")) return null;

  const root = pathApi.resolve(workspaceRoot);
  const resolved = pathApi.isAbsolute(candidate)
    ? pathApi.resolve(candidate)
    : pathApi.resolve(root, candidate);
  const relative = pathApi.relative(root, resolved);
  if (
    !relative
    || relative === ".."
    || relative.startsWith(`..${pathApi.sep}`)
    || pathApi.isAbsolute(relative)
  ) {
    return null;
  }
  return relative.split(pathApi.sep).join("/");
}

function normalizeActivityPayload(payload, workspaceRoot, pathApi, replacements) {
  const next = normalizePathFields(payload, workspaceRoot, pathApi, replacements);
  if (next.input && typeof next.input === "object" && !Array.isArray(next.input)) {
    next.input = normalizePathFields(next.input, workspaceRoot, pathApi, replacements);
    if (Array.isArray(next.input.changes)) {
      next.input.changes = normalizeChanges(next.input.changes, workspaceRoot, pathApi, replacements);
    }
  }
  if (Array.isArray(next.changes)) {
    next.changes = normalizeChanges(next.changes, workspaceRoot, pathApi, replacements);
  }
  if (Array.isArray(next.locations)) {
    next.locations = next.locations.flatMap((location) => {
      if (!location || typeof location !== "object" || Array.isArray(location)) return [];
      const normalized = normalizePathFields(location, workspaceRoot, pathApi, replacements);
      return typeof normalized.path === "string" ? [normalized] : [];
    });
  }
  if (Array.isArray(next.outputPaths)) {
    next.outputPaths = next.outputPaths.slice(0, 80).flatMap((candidate) => {
      const normalized = normalizeAgentWorkspaceEventPath(workspaceRoot, candidate, pathApi);
      if (!normalized) return [];
      replacements.set(candidate, normalized);
      return [normalized];
    });
    if (typeof next.outputPreview === "string") {
      next.outputPreview = next.outputPreview.split("\n").map(line => replacements.get(line) ?? line).join("\n");
    }
  }
  return next;
}

function normalizeChanges(changes, workspaceRoot, pathApi, replacements) {
  return changes.slice(0, 100).flatMap((change) => {
    if (!change || typeof change !== "object" || Array.isArray(change)) return [];
    const normalized = normalizePathFields(change, workspaceRoot, pathApi, replacements);
    return PATH_KEYS.some((key) => typeof normalized[key] === "string") ? [normalized] : [];
  });
}

function normalizePathFields(value, workspaceRoot, pathApi, replacements) {
  const next = { ...value };
  for (const key of PATH_KEYS) {
    if (typeof next[key] !== "string") continue;
    const original = next[key];
    const normalized = normalizeAgentWorkspaceEventPath(workspaceRoot, original, pathApi);
    if (!normalized) {
      delete next[key];
      replacements.set(original, pathApi.basename(original) || "file");
      continue;
    }
    next[key] = normalized;
    if (original !== normalized) replacements.set(original, normalized);
  }
  return next;
}

function replacePathMentions(value, replacements) {
  let next = value;
  for (const [original, normalized] of replacements) {
    next = next.replaceAll(original, normalized);
  }
  return next;
}
