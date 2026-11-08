import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { configureDesktopApplicationIdentity } from "../../../../electron/main/build-info-service.mjs";
import { resolveDesktopBuildIdentity } from "../../../../shared/desktop-build-identity.mjs";
import { resolveCliControlEndpoint } from "../../../../electron/main/cli-control/endpoint.mjs";

// Real Electron processes exercise Chromium storage and singleton locks together.
// No real application data, credentials, projects or Agent providers are used.
const filename = fileURLToPath(import.meta.url);
const childIndex = process.argv.indexOf("--instance-child");
if (childIndex >= 0) {
  const { app, session } = await import("electron");
  const [root, profile, marker] = process.argv.slice(childIndex + 1);
  app.setPath("appData", root);
  const isDaily = profile === "daily";
  const identity = configureDesktopApplicationIdentity({
    app: {
      isPackaged: isDaily,
      getPath: app.getPath.bind(app), setPath: app.setPath.bind(app),
      setName: app.setName.bind(app), setAppUserModelId: app.setAppUserModelId.bind(app),
    },
    projectRoot: root,
    environment: { PUPPYONE_DESKTOP_DEV_PROFILE: profile },
    buildInfo: resolveDesktopBuildIdentity({ baseVersion: "1.0.0", channel: "dev", commitSha: "a".repeat(40) }),
  });
  const locked = app.requestSingleInstanceLock();
  const report = value => process.stdout.write(`INSTANCE_RESULT ${JSON.stringify(value)}\n`);
  if (!locked) {
    report({ locked });
    app.exit(0);
  } else {
    app.on("window-all-closed", () => {});
    app.whenReady().then(async () => {
      const cookies = session.defaultSession.cookies;
      const existing = await cookies.get({ name: "isolation-marker" });
      await cookies.set({ url: "https://instance.test", name: "isolation-marker", value: marker,
        expirationDate: Math.floor(Date.now() / 1000) + 3600 });
      await cookies.flushStore();
      report({ locked, userData: app.getPath("userData"), sessionData: app.getPath("sessionData"),
        applicationId: identity.applicationId, previous: existing[0]?.value ?? null,
        endpoint: resolveCliControlEndpoint({ userDataPath: identity.userDataPath }) });
      process.stdin.once("data", () => app.quit());
    }).catch(error => { console.error(error); app.exit(1); });
  }
} else {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "p1-instance-smoke-"));
  const electron = createRequire(import.meta.url)("electron");
  const children = new Set();
  async function start(profile, marker) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [filename, "--instance-child", root, profile, marker], { env, stdio: ["pipe", "pipe", "pipe"] });
    children.add(child);
    const exit = new Promise(resolve => child.once("exit", code => { children.delete(child); resolve(code); }));
    const result = await new Promise((resolve, reject) => {
      let stdout = "", stderr = "";
      const timer = setTimeout(() => reject(new Error(`Instance ${profile} timed out: ${stderr}`)), 20_000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Instance ${profile} exited early (${code}): ${stderr}`)); });
      child.stderr.on("data", value => { stderr += value; });
      child.stdout.on("data", value => {
        stdout += value;
        const match = stdout.match(/INSTANCE_RESULT ([^\n]+)\n/);
        if (match) { clearTimeout(timer); resolve(JSON.parse(match[1])); }
      });
    });
    return { result, async stop() { child.stdin.end("quit\n"); assert.equal(await exit, 0); } };
  }
  try {
    const daily = await start("daily", "daily-state");
    const experiment = await start("experiment", "experiment-state");
    const second = await start("second", "second-state");
    assert.ok([daily, experiment, second].every(instance => instance.result.locked));
    assert.equal(new Set([daily, experiment, second].map(instance => instance.result.userData)).size, 3);
    for (const { result } of [daily, experiment, second]) {
      assert.equal(result.userData, result.sessionData);
      assert.equal(result.previous, null);
    }
    const duplicate = await start("daily", "must-not-overwrite");
    assert.equal(duplicate.result.locked, false);
    await experiment.stop();
    const restarted = await start("experiment", "experiment-next");
    assert.equal(restarted.result.previous, "experiment-state");
    await daily.stop();
    const dailyRestart = await start("daily", "daily-next");
    assert.equal(dailyRestart.result.previous, "daily-state");
    await Promise.all([dailyRestart.stop(), restarted.stop(), second.stop()]);
    console.log("PASS: three simultaneous profiles, duplicate lock, independent cookies, experiment restart and daily persistence.");
  } finally {
    for (const child of children) child.kill("SIGTERM");
    await Promise.all([...children].map(child => new Promise(resolve => child.once("exit", resolve))));
    await fs.rm(root, { recursive: true, force: true });
  }
}
