import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { GenericProvider } from "electron-updater/out/providers/GenericProvider.js";
import { createUpdateService } from "../../../../electron/update-service.mjs";
import { resolveDesktopBuildIdentity } from "../../../../shared/desktop-build-identity.mjs";
import { createDesktopElectronBuilderConfig } from "../../../../tooling/desktop/build/create-builder-config.mjs";

// The host need not be macOS to exercise the production macOS feed routing.
// Only the OS signature probe is replaced; metadata parsing is electron-updater's.
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal(),
  spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "Authority=Developer ID Application: Test" })),
}));

const cases = ["stable", "internal"].flatMap((channel) => [
  { channel, platform: "win32", target: { platform: "windows", arch: "x64" }, path: "windows/x64/nsis/latest", metadata: `${channel}.yml`, extension: "exe" },
  { channel, platform: "darwin", target: { platform: "macos", arch: "arm64" }, path: "mac/latest", metadata: `${channel}-mac.yml`, extension: "zip" },
]);

describe("packaged Desktop update feed routing", () => {
  it.each(cases)("discovers a $channel update on $platform using the published metadata contract", async ({ channel, platform, target, path, metadata, extension }) => {
    const buildInfo = resolveDesktopBuildIdentity({
      baseVersion: "1.4.0", channel, buildNumber: 72, commitSha: "d".repeat(40),
    });
    const candidateVersion = channel === "stable" ? "1.4.1" : "1.4.0-internal.73";
    const origin = channel === "stable" ? "https://updates.puppyone.ai" : "https://downloads.puppyone.ai";
    const expectedFeed = `${origin}/desktop/${channel}/${path}`;
    const filename = `puppyone-${candidateVersion}-${target.arch}.${extension}`;
    const checksum = Buffer.alloc(64, 1).toString("base64");
    const metadataSource = [
      `version: ${candidateVersion}`,
      "files:",
      `  - url: ${filename}`,
      `    sha512: ${checksum}`,
      "    size: 4096",
      `path: ${filename}`,
      `sha512: ${checksum}`,
    ].join("\n");
    const requests = [];
    const executor = {
      request: async (options) => {
        const url = `${options.protocol}//${options.hostname}${options.path}`;
        requests.push(url);
        // A wrong platform/channel path fails as a missing object would in production.
        if (url !== `${expectedFeed}/${metadata}`) throw new Error(`Unexpected update metadata request: ${url}`);
        return metadataSource;
      },
    };
    const autoUpdater = new EventEmitter();
    let provider;
    let resolvedFiles;
    Object.assign(autoUpdater, {
      isAddNoCacheQuery: false,
      setFeedURL: vi.fn((configuration) => {
        provider = new GenericProvider(configuration, autoUpdater, { platform, executor });
      }),
      checkForUpdates: vi.fn(async () => {
        const updateInfo = await provider.getLatestVersion();
        resolvedFiles = provider.resolveFiles(updateInfo);
        autoUpdater.emit("update-available", updateInfo);
        return { updateInfo };
      }),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
    });
    const service = createUpdateService({
      app: { isPackaged: true, getPath: () => "/Applications/PuppyOne.app/Contents/MacOS/PuppyOne" },
      autoUpdater,
      buildInfo,
      platform,
      arch: target.arch,
      environment: {},
      automaticallyDownloadUpdates: false,
      getWindows: () => [],
      ipcMain: { handle: vi.fn() },
    });
    try {
      service.start();
      await service.checkForUpdates();
      expect(service.getState()).toMatchObject({ status: "available", availableVersion: candidateVersion, error: null });
      expect(requests).toEqual([`${expectedFeed}/${metadata}`]);
      expect(resolvedFiles.map((file) => file.url.href)).toEqual([`${expectedFeed}/${filename}`]);
      const builder = createDesktopElectronBuilderConfig({ packageMetadata: {}, buildInfo, target });
      expect(autoUpdater.setFeedURL).toHaveBeenCalledExactlyOnceWith(builder.publish[0]);
      expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
      expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    } finally {
      service.dispose();
    }
  });
});
