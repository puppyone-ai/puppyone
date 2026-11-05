import { execFile, spawn } from "node:child_process";
import { closeSync, constants as fsConstants, openSync, renameSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/*
 * Reopens the app once the process that swapped it in has exited: a copy
 * opened while it still runs would hand itself to the old process and quit.
 * By then documents are saved and project resources stopped, so a process
 * still tearing down after the grace period is ended rather than waited on.
 * Paths come from the environment, so no command line here names the app.
 */
const RELAUNCH_SCRIPT = `
waited=0
while /bin/kill -0 "$PUPPYONE_UPDATE_PID" 2>/dev/null; do
  /bin/sleep 0.05
  waited=$((waited + 1))
  if [ "$waited" -eq "$PUPPYONE_UPDATE_GRACE_TICKS" ]; then
    printf '%s %s\\n' "$(/bin/date '+%Y-%m-%d %H:%M:%S')" "The app was still exiting; ending it to reopen the update."
    /bin/kill -9 "$PUPPYONE_UPDATE_PID" 2>/dev/null
  fi
  if [ "$waited" -ge $((PUPPYONE_UPDATE_GRACE_TICKS + 40)) ]; then
    printf '%s %s\\n' "$(/bin/date '+%Y-%m-%d %H:%M:%S')" "The app did not exit; not reopening it."
    exit 1
  fi
done
"$PUPPYONE_UPDATE_OPEN" "$PUPPYONE_UPDATE_APP"
`;

/**
 * macOS: an update made ready before it is offered, so restarting to update
 * only swaps two folders. Squirrel.Mac copies and verifies the whole new app
 * after the old one has quit, which leaves the person 30 to 50 seconds of
 * nothing on screen, and opening the app again meanwhile cancels the update.
 *
 * Here that work happens in the background, before "Restart to update" shows:
 * the new app is extracted beside the installed one on the same volume, and
 * must satisfy the installed app's own designated requirement (its identifier
 * and Developer ID team, as Squirrel.Mac requires) and carry the expected
 * version. As the app exits it swaps the two bundles itself, with two renames
 * (putting the installed one back if the second fails): macOS lets an app
 * change its own bundle, but not a script left running after it. Its running
 * code is unaffected, already open where the bundle has moved to. A detached
 * script then reopens the app once this process has ended, and the new app
 * removes the old bundle when it starts.
 *
 * Resolves null where that cannot work (an app outside a folder it may write,
 * on another volume than its staging folder, or after a swap has failed
 * once); Squirrel.Mac installs then.
 */
export async function createMacosPreparedUpdate({
  appBundlePath,
  stagingRoot,
  processId = process.pid,
  logger = console,
  run = (file, args) => execFileAsync(file, args, { maxBuffer: 4 * 1024 * 1024 }),
  startRelaunch = startDetachedRelaunch,
  openCommand = "/usr/bin/open",
  exitGraceMs = 5000,
}) {
  const failureMarker = `${stagingRoot}.failed`;
  const requirement = await readSupport({ appBundlePath, stagingRoot, failureMarker, run }).catch((error) => {
    logger.warn?.(`[desktop-updater] Restart swaps are unavailable; Squirrel.Mac installs updates: ${error.message}`);
    return null;
  });
  if (!requirement) return null;

  const nextRoot = path.join(stagingRoot, "next");
  const previousRoot = path.join(stagingRoot, "previous");
  // The app this one replaced, if any: only an app of the same team may remove it.
  await fs.rm(previousRoot, { recursive: true, force: true }).catch(() => undefined);
  let prepared = null;

  return Object.freeze({
    /** Extracts and verifies the downloaded app; throws when it may not be installed. */
    async prepare({ archivePath, version }) {
      prepared = null;
      if (typeof archivePath !== "string" || !archivePath) throw new Error("The downloaded update has no archive.");
      if (typeof version !== "string" || !version) throw new Error("The downloaded update has no version.");
      await fs.rm(stagingRoot, { recursive: true, force: true });
      await fs.mkdir(nextRoot, { recursive: true });
      await fs.mkdir(previousRoot, { recursive: true });
      await run("/usr/bin/ditto", ["-x", "-k", archivePath, nextRoot]);
      const bundles = (await fs.readdir(nextRoot)).filter((name) => name.endsWith(".app"));
      if (bundles.length !== 1) throw new Error(`The update holds ${bundles.length} apps instead of one.`);
      const bundlePath = path.join(nextRoot, bundles[0]);
      // Nothing quarantines what the updater writes; cleared in case anything did.
      await run("/usr/bin/xattr", ["-r", "-d", "com.apple.quarantine", bundlePath]).catch(() => undefined);
      await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R", `=${requirement}`, bundlePath])
        .catch((error) => { throw new Error(`The update is not signed as this app is: ${commandError(error)}`); });
      const buildInfo = JSON.parse(await fs.readFile(path.join(bundlePath, "Contents/Resources/build-info.json"), "utf8"));
      if (buildInfo?.version !== version) {
        throw new Error(`The update holds ${String(buildInfo?.version)} instead of ${version}.`);
      }
      prepared = { bundlePath, version };
      return { version };
    },

    /** The prepared version, or null. */
    preparedVersion: () => prepared?.version ?? null,

    /**
     * Swaps the prepared app in, as the very last thing before this process
     * exits, and reopens it once the process has ended when asked. Whatever
     * happens, a restart the person asked for reopens the app.
     */
    installOnExit({ relaunch }) {
      if (!prepared) return false;
      const { bundlePath, version } = prepared;
      prepared = null;
      let installed = false;
      try {
        const previous = path.join(previousRoot, path.basename(appBundlePath));
        renameSync(appBundlePath, previous);
        try {
          renameSync(bundlePath, appBundlePath);
        } catch (error) {
          renameSync(previous, appBundlePath);
          throw error;
        }
        installed = true;
        logger.info?.(`[desktop-updater] Installed ${version}; it opens from the next launch.`);
      } catch (error) {
        // Never offer a swap that cannot happen: the next update goes through Squirrel.Mac.
        logger.error?.(`[desktop-updater] Could not swap in ${version}: ${error.message}`);
        try { writeFileSync(failureMarker, `${new Date().toISOString()} ${error.message}\n`); } catch { /* Logged above. */ }
      }
      if (relaunch) {
        startRelaunch({
          script: RELAUNCH_SCRIPT,
          logPath: `${stagingRoot}.log`,
          env: {
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
            PUPPYONE_UPDATE_PID: String(processId),
            PUPPYONE_UPDATE_APP: appBundlePath,
            PUPPYONE_UPDATE_OPEN: openCommand,
            PUPPYONE_UPDATE_GRACE_TICKS: String(Math.max(1, Math.ceil(exitGraceMs / 50))),
          },
        });
      }
      return installed;
    },
  });
}

/** The installed app's designated requirement, once the swap is known to be possible. */
async function readSupport({ appBundlePath, stagingRoot, failureMarker, run }) {
  if (!appBundlePath?.endsWith(".app")) throw new Error(`${appBundlePath} is not an app bundle.`);
  const failure = await fs.readFile(failureMarker, "utf8").catch(() => null);
  if (failure !== null) throw new Error(`A swap failed before (${failure.trim()}).`);
  const folder = path.dirname(appBundlePath);
  await fs.access(folder, fsConstants.W_OK);
  await fs.access(appBundlePath, fsConstants.W_OK);
  await fs.mkdir(stagingRoot, { recursive: true });
  const [installed, staging] = await Promise.all([fs.stat(folder), fs.stat(stagingRoot)]);
  // Renames are instant and atomic only within one volume.
  if (installed.dev !== staging.dev) throw new Error(`${folder} and ${stagingRoot} are on different volumes.`);
  const { stdout = "", stderr = "" } = await run("/usr/bin/codesign", ["-d", "-r-", appBundlePath]);
  const requirement = /^designated => (.+)$/m.exec(`${stdout}\n${stderr}`)?.[1]?.trim();
  if (!requirement) throw new Error("The installed app has no designated requirement.");
  return requirement;
}

function startDetachedRelaunch({ script, env, logPath }) {
  const log = openSync(logPath, "a");
  try {
    spawn("/bin/sh", ["-c", script], { detached: true, stdio: ["ignore", log, log], env }).unref();
  } finally {
    closeSync(log);
  }
}

function commandError(error) {
  return String(error?.stderr || error?.message || error).trim().split("\n").at(-1);
}
