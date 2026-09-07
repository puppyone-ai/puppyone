import { createAgentFileChangeEvidence } from "../runtime/agent-file-change-evidence.mjs";

/** Read compatibility for v1 journal entries that predate canonical edit evidence.
 * The journal stays intact; only its display projection is enriched. */
export function legacyFileChangeEvidence(payload) {
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  if (changes.length > 1 || (Array.isArray(payload.changes) && changes.every(change => change && Object.hasOwn(change, "diff")))) return null;
  const input = payload.input && typeof payload.input === "object" ? payload.input : {};
  const path = payload.path || input.path || input.file_path || input.filePath || input.file || changes[0]?.path;
  if (!path) return null;
  const before = input.old_string ?? input.oldString ?? input.oldText;
  const after = input.new_string ?? input.newString ?? input.newText;
  const diff = payload.diff ?? payload.patch ?? input.diff ?? input.patch;
  if (typeof diff !== "string" && !(typeof before === "string" && typeof after === "string")) return null;
  const [evidence] = createAgentFileChangeEvidence([{ path, before, after, diff,
    scope: "fragment", basis: typeof diff === "string" ? "native" : "request", unknownMultiplicity: input.replace_all === true }]);
  return evidence ? [{ ...evidence, ...changes[0], diff: evidence.diff, ...(evidence.truncated ? { truncated: true } : {}) }] : null;
}
