import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createMacosPreparedUpdate } from "../../../../electron/main/platform/macos/prepared-update.mjs";

const run = promisify(execFile);
const IDENTIFIER = "ai.puppyone.test.prepared-update";
const BUNDLE_MTIME = new Date("2000-01-01T00:00:00.000Z");
const roots = [];
const processes = [];

afterEach(async () => {
  for (const child of processes.splice(0)) child.kill("SIGKILL");
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

/**
 * Real ditto, codesign, renames, and a real detached relaunch, on throwaway
 * apps signed ad hoc with an identifier requirement: a release app's
 * requirement names its Developer ID team instead, checked the same way.
 */
describe.runIf(process.platform === "darwin")("macOS prepared update", () => {
  it("swaps in a verified update as the app exits and reopens it a moment after", async () => {
    const world = await createWorld();
    const app = await world.runningApp();
    const update = await world.prepared({ processId: app.pid });

    await expect(update.prepare({ archivePath: await world.archive("2.0.0"), version: "2.0.0" })).resolves.toEqual({ version: "2.0.0" });
    expect(await world.installedVersion()).toBe("1.0.0");
    const swapStartedAt = performance.now();
    expect(update.installOnExit({ relaunch: true })).toBe(true);
    expect(performance.now() - swapStartedAt).toBeLessThan(200);
    expect(update.installOnExit({ relaunch: true })).toBe(false);
    expect(await world.installedVersion()).toBe("2.0.0");

    // Not reopened while the old process still runs: a new copy would hand itself to it.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await world.opened()).toBeNull();
    const exitedAt = Date.now();
    world.quitApp();
    await world.until(() => world.opened());
    expect(Date.now() - exitedAt).toBeLessThan(1000);
    expect(await world.opened()).toBe(world.appPath);

    // The new app clears the one it replaced when it starts.
    expect(await fs.readdir(path.join(world.stagingRoot, "previous"))).toEqual(["Prepared Test.app"]);
    await world.prepared();
    await expect(fs.access(path.join(world.stagingRoot, "previous"))).rejects.toThrow();
  });

  it("ends an app still exiting after the grace period and reopens the update", async () => {
    const world = await createWorld();
    // Stuck in teardown: it ignores the request to stop.
    const stuck = spawn("/bin/sh", ["-c", "trap '' TERM; while :; do /bin/sleep 1; done"], { stdio: "ignore" });
    processes.push(stuck);
    const update = await world.prepared({ processId: stuck.pid, exitGraceMs: 300 });
    await update.prepare({ archivePath: await world.archive("2.0.0"), version: "2.0.0" });

    const swappedAt = Date.now();
    update.installOnExit({ relaunch: true });
    stuck.kill("SIGTERM");
    await world.until(() => world.opened());
    expect(Date.now() - swappedAt).toBeLessThan(1500);
    expect(stuck.exitCode ?? stuck.signalCode).toBe("SIGKILL");
    expect(await fs.readFile(`${world.stagingRoot}.log`, "utf8")).toContain("ending it to reopen the update");
  });

  it("swaps an update in on an ordinary quit without reopening the app", async () => {
    const world = await createWorld();
    const update = await world.prepared({ processId: (await world.runningApp()).pid });
    await update.prepare({ archivePath: await world.archive("2.0.0"), version: "2.0.0" });

    expect(update.installOnExit({ relaunch: false })).toBe(true);
    expect(await world.installedVersion()).toBe("2.0.0");
    world.quitApp();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await world.opened()).toBeNull();
  });

  it("keeps the installed app, still reopens it, and stops offering swaps when one fails", async () => {
    const world = await createWorld();
    const update = await world.prepared({ processId: 999_999, logger: { info: () => undefined, error: () => undefined } });
    await update.prepare({ archivePath: await world.archive("2.0.0"), version: "2.0.0" });

    await fs.chmod(path.dirname(world.appPath), 0o555);
    try {
      expect(update.installOnExit({ relaunch: true })).toBe(false);
    } finally {
      await fs.chmod(path.dirname(world.appPath), 0o755);
    }
    expect(await world.installedVersion()).toBe("1.0.0");
    await world.until(() => world.opened());
    expect(await world.prepared({ logger: { warn: () => undefined } })).toBeNull();
  });

  it("refuses an update signed otherwise, holding another version, or changed after signing", async () => {
    const world = await createWorld();
    const update = await world.prepared();

    await expect(update.prepare({ archivePath: await world.archive("2.0.0", { identifier: "ai.puppyone.someone-else" }), version: "2.0.0" }))
      .rejects.toThrow(/not signed as this app is/);
    await expect(update.prepare({ archivePath: await world.archive("2.0.0"), version: "2.0.1" }))
      .rejects.toThrow(/holds 2\.0\.0 instead of 2\.0\.1/);
    await expect(update.prepare({ archivePath: await world.archive("2.0.0", { tamper: true }), version: "2.0.0" }))
      .rejects.toThrow(/not signed as this app is/);
    expect(update.installOnExit({ relaunch: true })).toBe(false);
  });

  it("is unavailable for an app it could not move", async () => {
    const world = await createWorld();
    await fs.chmod(path.dirname(world.appPath), 0o555);
    try {
      expect(await world.prepared({ logger: { warn: () => undefined } })).toBeNull();
    } finally {
      await fs.chmod(path.dirname(world.appPath), 0o755);
    }
  });
});

async function createWorld() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-prepared-update-")));
  roots.push(root);
  const appPath = path.join(root, "Applications", "Prepared Test.app");
  const stagingRoot = path.join(root, "Caches", "prepared-test.prepared-update");
  // A fresh unsigned script can spend over a second in macOS execution checks.
  // Use a trusted native command to observe the actual dispatch and target;
  // keep the real detached process and the existing sub-second assertion.
  const openCommand = "/usr/bin/touch";
  await buildApp(appPath, "1.0.0");
  let running = null;

  return {
    appPath,
    stagingRoot,
    prepared: (options = {}) => createMacosPreparedUpdate({ appBundlePath: appPath, stagingRoot, openCommand, ...options }),
    /** A process run from the installed app, as the app itself would be. */
    async runningApp() {
      const child = spawn(path.join(appPath, "Contents/MacOS/prepared-test"), ["60"], { stdio: "ignore" });
      processes.push(child);
      running = child;
      return child;
    },
    quitApp: () => running?.kill("SIGTERM"),
    async archive(version, { identifier = IDENTIFIER, tamper = false } = {}) {
      const build = path.join(root, `build-${version}-${identifier}-${tamper}`, "Prepared Test.app");
      await buildApp(build, version, identifier);
      if (tamper) await fs.appendFile(path.join(build, "Contents/Resources/build-info.json"), " ");
      const archive = `${path.dirname(build)}.zip`;
      await run("/usr/bin/ditto", ["-c", "-k", "--keepParent", build, archive]);
      return archive;
    },
    async installedVersion() {
      return JSON.parse(await fs.readFile(path.join(appPath, "Contents/Resources/build-info.json"), "utf8")).version;
    },
    opened: async () => (await fs.stat(appPath)).mtimeMs > BUNDLE_MTIME.getTime() ? appPath : null,
    async until(probe, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (!(await probe())) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for the swap.");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
  };
}

async function buildApp(appPath, version, identifier = IDENTIFIER) {
  await fs.mkdir(path.join(appPath, "Contents/MacOS"), { recursive: true });
  await fs.mkdir(path.join(appPath, "Contents/Resources"), { recursive: true });
  await fs.writeFile(path.join(appPath, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${identifier}</string>
<key>CFBundleExecutable</key><string>prepared-test</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`);
  await fs.writeFile(path.join(appPath, "Contents/Resources/build-info.json"), JSON.stringify({ version }));
  await fs.copyFile("/bin/sleep", path.join(appPath, "Contents/MacOS/prepared-test"));
  // Ad hoc, with the requirement a release app's would hold: its identifier.
  await run("/usr/bin/codesign", ["--force", "--sign", "-", "-r=designated => identifier \"" + IDENTIFIER + "\"", appPath]);
  await fs.utimes(appPath, BUNDLE_MTIME, BUNDLE_MTIME);
}
