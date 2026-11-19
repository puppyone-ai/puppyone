import { createHash } from "node:crypto";
import path from "node:path";

// sockaddr_un.sun_path is 104 bytes on macOS, including the terminator.
const MAX_SOCKET_PATH_BYTES = 103;

/**
 * Where Desktop listens for one user and one channel. The CLI computes the
 * same path from Info.plist, so this rule is a cross-repository contract.
 * Long home directories fall back to a per-user directory under /tmp.
 * Windows has no endpoint yet.
 */
export function resolveCliControlEndpoint({ userDataPath, platform = process.platform, uid }) {
  if (platform === "win32" || typeof userDataPath !== "string" || !userDataPath) return null;
  const preferred = path.join(userDataPath, "cli", "control.sock");
  if (Buffer.byteLength(preferred, "utf8") <= MAX_SOCKET_PATH_BYTES) return preferred;
  const identity = createHash("sha256").update(userDataPath).digest("hex").slice(0, 16);
  return path.join("/tmp", `puppyone-cli-${uid}`, `${identity}.sock`);
}
