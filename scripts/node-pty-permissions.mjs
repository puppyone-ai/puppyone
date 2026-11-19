import { chmodSync, statSync } from "node:fs";
import path from "node:path";

/** Repair dependency permissions before launching or copying a Desktop build. */
export function repairNodePtyPermissions(desktopRoot) {
  const repaired = [];
  // node-pty prefers a local Release/Debug build over its platform prebuild.
  const directories = ["build/Release", "build/Debug", "prebuilds/darwin-arm64", "prebuilds/darwin-x64"];
  for (const directory of directories) {
    const helperPath = path.join(desktopRoot, "node_modules", "node-pty", directory, "spawn-helper");
    let stat;
    try {
      stat = statSync(helperPath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!stat.isFile()) throw new Error(`node-pty spawn-helper is not a file: ${helperPath}`);
    if ((stat.mode & 0o111) === 0o111) continue;
    try {
      chmodSync(helperPath, (stat.mode & 0o777) | 0o111);
    } catch (cause) {
      throw new Error(`Cannot make node-pty spawn-helper executable: ${helperPath}`, { cause });
    }
    repaired.push(helperPath);
  }
  return repaired;
}
