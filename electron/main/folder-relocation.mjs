import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nearestExistingAncestor, probeFolderAvailability } from "./folder-availability.mjs";

const CANDIDATE_LIFETIME_MS = 10 * 60_000;
const SIBLING_SCAN_LIMIT = 2000;

/**
 * Finding a project's folder after it moved, was renamed or its disk went away.
 *
 * The renderer may ask about, and relocate, only projects Main already knows: its recent
 * projects and the folders of its own window. A new place comes either from the person's
 * choice in the system dialog or from Main's own search, and reaches the renderer only as
 * a one-time candidate it can confirm, never as a path it could substitute.
 */
export function createFolderRelocation({
  listRecentWorkspaces,
  windowFolderPaths,
  resolveIdentity,
  showOpenDialog,
  relocateRecent,
  retireSharesAtMissingRoot = async () => ({ retired: 0 }),
  home = "",
  fsModule = fs,
  platform = process.platform,
  now = () => Date.now(),
}) {
  const candidates = new Map();

  async function known(sender, folderPath) {
    const target = typeof folderPath === "string" ? path.resolve(folderPath) : null;
    if (!target) return null;
    const recent = (await listRecentWorkspaces()).find((workspace) => workspace.path === target) ?? null;
    if (recent) return recent;
    const inWindow = (await windowFolderPaths(sender)).some((folder) => folder === target);
    return inWindow ? { path: target, name: path.basename(target) } : null;
  }

  function offer(from, to, match, name) {
    for (const [token, candidate] of candidates) if (candidate.expiresAt < now()) candidates.delete(token);
    const token = crypto.randomUUID();
    candidates.set(token, { from, to, expiresAt: now() + CANDIDATE_LIFETIME_MS });
    return { token, path: to, name, match };
  }

  async function matchOf(record, candidatePath) {
    const identity = await resolveIdentity(candidatePath).catch(() => null);
    if (!identity) return "different";
    if (record.fsIdentity && identity.fsIdentity === record.fsIdentity) return "same-folder";
    if (record.puppyoneGitRemote && identity.puppyoneGitRemote
      && JSON.stringify(identity.puppyoneGitRemote) === JSON.stringify(record.puppyoneGitRemote)) return "same-cloud-project";
    return "different";
  }

  /** The same folder, renamed where it was: the commonest way a project goes missing. */
  async function renamedInPlace(record) {
    if (!record.fsIdentity?.startsWith("fs:")) return null;
    const parent = path.dirname(record.path);
    const entries = await fsModule.promises.readdir(parent, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.slice(0, SIBLING_SCAN_LIMIT)) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(parent, entry.name);
      const info = await fsModule.promises.stat(candidate).catch(() => null);
      if (info && `fs:${Number(info.dev)}:${Number(info.ino)}` === record.fsIdentity) return candidate;
    }
    return null;
  }

  return Object.freeze({
    /** Whether each known folder can be opened now; a renamed one comes with where it is. */
    async status(sender, folderPaths) {
      const results = [];
      for (const folderPath of Array.isArray(folderPaths) ? folderPaths.slice(0, 256) : []) {
        const record = await known(sender, folderPath);
        if (!record) continue;
        const { state } = await probeFolderAvailability(record.path, { fsModule, platform });
        const found = state === "missing" ? await renamedInPlace(record) : null;
        results.push({
          path: record.path,
          state,
          ...(found ? { suggestion: offer(record.path, found, "same-folder", path.basename(found)) } : {}),
        });
      }
      return results;
    },

    /** The person points at where the folder is now; Main says whether it is the same one. */
    async locate(sender, folderPath, ownerWindow) {
      const record = await known(sender, folderPath);
      if (!record) throw new Error("This project is not one PuppyOne knows.");
      const defaultPath = await nearestExistingAncestor(record.path, { fsModule, home });
      const result = await showOpenDialog(ownerWindow, {
        defaultPath: defaultPath ?? undefined,
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return { status: "cancelled" };
      const chosen = await fsModule.promises.realpath(result.filePaths[0]);
      if (chosen === record.path) return { status: "unchanged" };
      return { status: "selected", ...offer(record.path, chosen, await matchOf(record, chosen), path.basename(chosen)) };
    },

    /** Use the confirmed place from now on, everywhere PuppyOne remembers this project. */
    async relocate(token) {
      const candidate = typeof token === "string" ? candidates.get(token) : null;
      candidates.delete(token);
      if (!candidate || candidate.expiresAt < now()) throw new Error("Choose the folder again.");
      const { state } = await probeFolderAvailability(candidate.to, { fsModule, platform });
      if (state !== "available") throw new Error("That folder can no longer be opened.");
      const relocated = await relocateRecent(candidate.from, candidate.to);
      const { retired } = await retireSharesAtMissingRoot(candidate.from);
      return { from: candidate.from, path: relocated.path, wasShared: Boolean(relocated.wasShared) || retired > 0 };
    },
  });
}
