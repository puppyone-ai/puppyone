import fs from "node:fs/promises";
import os from "node:os";
import { resolveDevelopmentProfile } from "../../../../electron/main/development-instance.mjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureDesktopApplicationIdentity } from "../../../../electron/main/build-info-service.mjs";
import { hostServiceStateDir } from "../../../../electron/host-service/paths.mjs";
import { getDesktopBuildChannelPolicy, resolveDesktopBuildIdentity } from "../../../../shared/desktop-build-identity.mjs";

let appData;
const projectRoot = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
beforeEach(async () => {
  appData = await fs.mkdtemp(path.join(os.tmpdir(), "host-entry-"));
  vi.stubEnv("PUPPYONE_DESKTOP_DEV_PROFILE", "");
});
const devProfile = () => resolveDevelopmentProfile({ projectRoot, environment: {} });

afterEach(async () => {
  await fs.rm(appData, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.doUnmock("electron");
  vi.doUnmock("../../../../electron/main/build-info-service.mjs");
  vi.doUnmock("../../../../electron/host-service/runtime.mjs");
  vi.resetModules();
});

async function launch(channel, { lockGranted = true } = {}) {
  vi.resetModules();
  const buildInfo = resolveDesktopBuildIdentity({ baseVersion: "0.4.2", channel,
    buildNumber: 18, commitSha: "c".repeat(40) });
  // Electron starts with the package name, not the Desktop channel's profile.
  let userData = path.join(appData, "@puppyone", "desktop");
  let lockPath;
  const app = {
    isPackaged: channel !== "dev",
    getPath: vi.fn((name) => name === "appData" ? appData : userData),
    setName: vi.fn(),
    setPath: vi.fn((name, value) => { if (name === "userData") userData = value; }),
    setAppUserModelId: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => { lockPath = userData; return lockGranted; }),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    exit: vi.fn(),
    quit: vi.fn(),
    dock: { hide: vi.fn() },
  };
  const loadDesktopBuildInfo = vi.fn(() => buildInfo);
  const runHostService = vi.fn(async () => ({ close: vi.fn(), service: { suspend: vi.fn(), wake: vi.fn() } }));
  vi.doMock("electron", () => ({ app, powerMonitor: { on: vi.fn() }, safeStorage: {}, utilityProcess: {} }));
  vi.doMock("../../../../electron/main/build-info-service.mjs", () => ({
    loadDesktopBuildInfo, configureDesktopApplicationIdentity,
  }));
  vi.doMock("../../../../electron/host-service/runtime.mjs", () => ({ runHostService }));
  await import("../../../../electron/host-service/electron-main.mjs");
  return { app, buildInfo, loadDesktopBuildInfo, lockPath, runHostService, userData };
}

describe("Host's Electron entry", () => {
  it.each(["dev", "internal", "stable"])("uses Desktop's %s identity before choosing its profile and lock", async (channel) => {
    const { app, buildInfo, loadDesktopBuildInfo, lockPath, runHostService, userData } = await launch(channel);
    const policy = getDesktopBuildChannelPolicy(channel);
    const desktopProfile = path.join(appData, channel === "dev" ? `${policy.userDataName}-${devProfile()}` : policy.userDataName);
    const stateDir = hostServiceStateDir(desktopProfile);
    expect(loadDesktopBuildInfo).toHaveBeenCalledWith(expect.objectContaining({
      app, packageMetadata: expect.objectContaining({ name: "@puppyone/desktop" }),
      projectRoot: path.resolve(fileURLToPath(new URL("../../../../", import.meta.url))),
    }));
    expect(app.setName).toHaveBeenCalledWith(channel === "dev" ? `${policy.applicationName} (${devProfile()})` : policy.applicationName);
    expect(app.setPath.mock.calls.filter(([name]) => name === "userData")).toEqual([["userData", desktopProfile], ["userData", stateDir]]);
    expect(app.setPath).toHaveBeenCalledWith("sessionData", stateDir);
    expect(userData).toBe(stateDir);
    expect(lockPath).toBe(stateDir);
    expect(lockPath).not.toBe(desktopProfile);
    expect(runHostService).toHaveBeenCalledWith(expect.objectContaining({ stateDir, appVersion: buildInfo.version }));
  });

  it("leaves the existing Host alone when its own channel's lock is held", async () => {
    const { app, runHostService, lockPath } = await launch("dev", { lockGranted: false });
    expect(lockPath).toBe(path.join(appData, `${getDesktopBuildChannelPolicy("dev").userDataName}-${devProfile()}`, "host-service"));
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.whenReady).not.toHaveBeenCalled();
    expect(runHostService).not.toHaveBeenCalled();
  });
});
