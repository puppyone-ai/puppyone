import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";

/** A runtime profile is local state, never a fourth build/release channel. */
export function resolveDevelopmentProfile({ projectRoot, environment = process.env, platform = process.platform }) {
  const configured = environment.PUPPYONE_DESKTOP_DEV_PROFILE;
  if (configured !== undefined && configured !== "") {
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(configured)) {
      throw new Error("Development profile must contain 1–32 lowercase letters, digits or hyphens.");
    }
    return configured;
  }
  // Resolve symlinks so opening the same checkout through an alias keeps its lock.
  const root = realpathSync(projectRoot);
  const canonicalRoot = platform === "win32" ? root.toLowerCase() : root;
  return `worktree-${createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 12)}`;
}
