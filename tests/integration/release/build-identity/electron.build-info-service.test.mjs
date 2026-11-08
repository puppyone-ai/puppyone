import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  configureDesktopApplicationIdentity,
  loadDesktopBuildInfo,
} from "../../../../electron/main/build-info-service.mjs";
import { resolveDesktopBuildIdentity } from "../../../../shared/desktop-build-identity.mjs";

const temporaryDirectories = [];
const commitSha = "c".repeat(40);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { force: true, recursive: true })
  )));
});

describe("Electron Build Identity service", () => {
  it("loads and verifies the identity embedded in a packaged application", async () => {
    const resourcesPath = await createTemporaryDirectory();
    const buildInfo = resolveDesktopBuildIdentity({
      baseVersion: "2.0.0",
      buildNumber: 18,
      builtAt: "2026-07-26T10:00:00.000Z",
      channel: "internal",
      commitSha,
    });
    await fs.writeFile(
      path.join(resourcesPath, "build-info.json"),
      `${JSON.stringify(buildInfo)}\n`,
    );

    expect(loadDesktopBuildInfo({
      app: {
        getVersion: () => "2.0.0-internal.18",
        isPackaged: true,
      },
      packageMetadata: { version: "2.0.0" },
      projectRoot: resourcesPath,
      resourcesPath,
    })).toEqual(buildInfo);
  });

  it("fails closed when packaged metadata is absent or disagrees with Electron", async () => {
    const resourcesPath = await createTemporaryDirectory();
    expect(() => loadDesktopBuildInfo({
      app: { getVersion: () => "2.0.0", isPackaged: true },
      packageMetadata: { version: "2.0.0" },
      projectRoot: resourcesPath,
      resourcesPath,
    })).toThrow(/missing valid build-info\.json/);

    const buildInfo = resolveDesktopBuildIdentity({
      baseVersion: "2.0.0",
      buildNumber: 18,
      channel: "stable",
      commitSha,
    });
    await fs.writeFile(path.join(resourcesPath, "build-info.json"), JSON.stringify(buildInfo));
    expect(() => loadDesktopBuildInfo({
      app: { getVersion: () => "2.0.1", isPackaged: true },
      packageMetadata: { version: "2.0.0" },
      projectRoot: resourcesPath,
      resourcesPath,
    })).toThrow(/does not match Build Identity/);
  });

  it("uses a prepared development identity without accepting a published channel", async () => {
    const projectRoot = await createTemporaryDirectory();
    await fs.mkdir(path.join(projectRoot, "generated"));
    const buildInfo = resolveDesktopBuildIdentity({
      baseVersion: "2.0.0",
      builtAt: "2026-07-26T10:00:00.000Z",
      channel: "dev",
      commitSha,
      sourceDirty: true,
    });
    await fs.writeFile(
      path.join(projectRoot, "generated", "desktop-build-info.json"),
      JSON.stringify(buildInfo),
    );

    expect(loadDesktopBuildInfo({
      app: { isPackaged: false },
      packageMetadata: { version: "2.0.0" },
      projectRoot,
    })).toEqual(buildInfo);
  });

  it("configures name, user data, and Windows application identity before startup", async () => {
    const appDataPath = await createTemporaryDirectory();
    const userDataPath = path.join(appDataPath, "puppyone-internal");
    const app = {
      getPath: vi.fn(() => appDataPath),
      setAppUserModelId: vi.fn(),
      setName: vi.fn(),
      setPath: vi.fn(),
    };
    const buildInfo = resolveDesktopBuildIdentity({
      baseVersion: "2.0.0",
      buildNumber: 18,
      channel: "internal",
      commitSha,
    });

    expect(configureDesktopApplicationIdentity({
      app,
      buildInfo,
      platform: "win32",
    })).toEqual({
      applicationId: "ai.puppyone.desktop.internal",
      applicationName: "PuppyOne Internal",
      userDataPath,
    });
    expect(app.setName).toHaveBeenCalledWith("PuppyOne Internal");
    expect(app.setPath).toHaveBeenCalledWith(
      "userData",
      userDataPath,
    );
    expect(app.setAppUserModelId).toHaveBeenCalledWith("ai.puppyone.desktop.internal");
  });
  it("isolates source checkouts and Chromium storage while retaining daily packaged data", async () => {
    const appData = await createTemporaryDirectory();
    const checkoutA = await createTemporaryDirectory();
    const checkoutB = await createTemporaryDirectory();
    const buildInfo = resolveDesktopBuildIdentity({ baseVersion: "2.0.0", channel: "dev", commitSha });
    const configure = (projectRoot, isPackaged = false, environment = {}) => {
      const paths = { appData };
      const app = {
        isPackaged, getPath: name => paths[name], setName: vi.fn(),
        setPath: (name, value) => { paths[name] = value; }, setAppUserModelId: vi.fn(),
      };
      const identity = configureDesktopApplicationIdentity({ app, buildInfo, projectRoot, environment, platform: "win32" });
      return { ...identity, paths, app };
    };
    const first = configure(checkoutA);
    const second = configure(checkoutB);
    const daily = configure(checkoutA, true, { PUPPYONE_DESKTOP_DEV_PROFILE: "experiment" });
    expect(first.userDataPath).not.toBe(second.userDataPath);
    expect(first.userDataPath).not.toBe(daily.userDataPath);
    expect(first.userDataPath).toBe(configure(checkoutA).userDataPath);
    expect(first.paths.sessionData).toBe(first.userDataPath);
    expect(first.paths.logs).toBe(path.join(first.userDataPath, "logs"));
    expect(first.app.setAppUserModelId).toHaveBeenCalledWith(first.applicationId);
    expect(first.applicationId).not.toBe(second.applicationId);
    expect(daily.userDataPath).toBe(path.join(appData, "puppyone-development"));
    await expect(fs.stat(first.userDataPath)).resolves.toBeDefined();
    const named = configure(checkoutA, false, { PUPPYONE_DESKTOP_DEV_PROFILE: "agent-call-exp" });
    expect(named.userDataPath).toBe(configure(checkoutB, false, { PUPPYONE_DESKTOP_DEV_PROFILE: "agent-call-exp" }).userDataPath);
    expect(named.applicationName).toContain("agent-call-exp");
    expect(() => configure(checkoutA, false, { PUPPYONE_DESKTOP_DEV_PROFILE: "../../daily" })).toThrow(/profile/i);
  });

});

async function createTemporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-build-info-"));
  temporaryDirectories.push(directory);
  return directory;
}
