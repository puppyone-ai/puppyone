import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

/** Read only bundle metadata; never launch a discovered app or inspect its data. */
export function createCompanionAppPort({
  nodePlatform = process.platform,
  roots = ["/Applications", path.join(os.homedir(), "Applications")],
  fsModule = fs,
  readMetadata = readBundleMetadata,
  timeoutMs = 3_000,
} = {}) {
  // Separate capacity from CLI discovery. Timed-out, uninterruptible filesystem
  // operations retain their slot until they settle, including after disposal.
  let pending = 0;
  async function inspect(identities, { signal } = {}) {
    if (nodePlatform !== "darwin") return observations(identities, "unsupported");
    if (pending >= 2 || signal?.aborted) return observations(identities, "unknown");
    pending += 1;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let timer;
    const work = scan(identities, controller.signal).finally(() => { pending -= 1; });
    try {
      return await Promise.race([work, new Promise((resolve) => {
        timer = setTimeout(() => { abort(); resolve(observations(identities, "unknown")); }, timeoutMs);
      })]);
    } catch {
      return observations(identities, "unknown");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async function scan(identities, signal) {
    const found = new Set();
    let incomplete = false;
    for (const root of roots.slice(0, 2)) {
      let directory;
      try {
        signal.throwIfAborted();
        directory = await fsModule.opendir(root);
        let count = 0;
        for await (const entry of directory) {
          signal.throwIfAborted();
          if (++count > 256) { incomplete = true; break; }
          if (!entry.name.endsWith(".app") || !entry.isDirectory()) continue;
          const contents = path.join(root, entry.name, "Contents");
          try {
            const plistPath = path.join(contents, "Info.plist");
            const stat = await fsModule.stat(plistPath);
            if (!stat.isFile() || stat.size > 128 * 1024) { incomplete = true; continue; }
            const metadata = await readMetadata(plistPath, signal);
            const identity = identities.find(({ bundleId }) => bundleId === metadata.CFBundleIdentifier);
            if (!identity) continue;
            const executable = metadata.CFBundleExecutable;
            if (typeof executable !== "string" || !/^[^/\\\u0000]{1,160}$/u.test(executable)
              || executable === "." || executable === "..") { incomplete = true; continue; }
            const executablePath = path.join(contents, "MacOS", executable);
            if (!(await fsModule.stat(executablePath)).isFile()) { incomplete = true; continue; }
            await fsModule.access(executablePath, 1);
            found.add(identity.id);
          } catch { incomplete = true; }
          if (found.size === identities.length) break;
        }
      } catch (error) {
        if (error?.code !== "ENOENT") incomplete = true;
      }
    }
    return identities.map(({ id }) => ({
      companionId: id,
      status: found.has(id) ? "present" : incomplete ? "unknown" : "not-found",
    }));
  }
  return Object.freeze({ inspect, nodePlatform });
}

function observations(identities, status) {
  return identities.map(({ id }) => ({ companionId: id, status }));
}

function readBundleMetadata(plistPath, signal) {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", plistPath], {
      encoding: "utf8", maxBuffer: 128 * 1024, timeout: 500, signal,
    }, (error, stdout) => {
      if (error) { reject(error); return; }
      try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
    });
  });
}
