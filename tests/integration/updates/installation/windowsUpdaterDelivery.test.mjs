import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import os from "node:os";
import path from "node:path";
import { dump } from "js-yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NsisUpdater } from "electron-updater/out/NsisUpdater.js";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor.js";
import { createUpdateService } from "../../../../electron/update-service.mjs";
import { resolveDesktopBuildIdentity } from "../../../../shared/desktop-build-identity.mjs";
import { createDesktopElectronBuilderConfig } from "../../../../tooling/desktop/build/create-builder-config.mjs";

const fixtures = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose();
});

describe("Windows updater delivery with real HTTP and NSIS download handling", () => {
  it("downloads and verifies a newer release before handing it to the install action", async () => {
    const fixture = await createFixture();
    const { service, updater, states } = fixture.start();

    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({ status: "downloaded", availableVersion: "1.4.1", error: null });
    expect(states).toEqual(expect.arrayContaining(["checking", "available", "downloading", "downloaded"]));
    expect(await readFile(updater.installerPath)).toEqual(fixture.payload);
    expect(fixture.requests).toEqual([fixture.metadataPath, fixture.artifactPath]);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    await Promise.all([service.updateNow(), service.updateNow()]);

    expect(service.getState().status).toBe("installing");
    expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);
    expect(fixture.requests).toHaveLength(2);
  });

  it("honors download opt-out until the user explicitly downloads", async () => {
    const fixture = await createFixture();
    const { service, updater } = fixture.start({ automaticallyDownloadUpdates: false });

    await service.checkForUpdates();
    expect(service.getState().status).toBe("available");
    expect(fixture.requests).toEqual([fixture.metadataPath]);
    expect(updater.installerPath).toBeNull();

    await service.downloadUpdate();
    expect(service.getState().status).toBe("downloaded");
    expect(await readFile(updater.installerPath)).toEqual(fixture.payload);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it.each([
    ["metadata 404", { metadataStatus: 404 }, /404/],
    ["invalid metadata", { invalidMetadata: true }, /parse update info/i],
    ["installer 503", { artifactStatus: 503 }, /503/],
    ["interrupted download", { interruptDownload: true }, /aborted|socket hang up/i],
    ["checksum mismatch", { corruptPayload: true }, /sha512 checksum mismatch/i],
  ])("keeps %s failures retryable without making an invalid installer actionable", async (_name, failure, errorPattern) => {
    const fixture = await createFixture(failure);
    const { service, updater } = fixture.start();

    await service.checkForUpdates();
    expect(service.getState()).toMatchObject({ status: "error", error: expect.stringMatching(errorPattern) });
    expect(updater.installerPath).toBeNull();
    await service.installDownloadedUpdate();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.spawnLog).not.toHaveBeenCalled();

    Object.assign(fixture.response, {
      metadataStatus: 200, artifactStatus: 200, corruptPayload: false, invalidMetadata: false, interruptDownload: false,
    });
    await service.checkForUpdates();
    expect(service.getState()).toMatchObject({ status: "downloaded", error: null });
    expect(await readFile(updater.installerPath)).toEqual(fixture.payload);
  });

  it.each([false, true])("validates persisted download cache after relaunch (corrupted: %s)", async (corrupted) => {
    const fixture = await createFixture();
    const first = fixture.start();
    await first.service.checkForUpdates();
    expect(first.service.getState().status).toBe("downloaded");
    first.service.dispose();
    if (corrupted) await writeFile(first.updater.installerPath, "corrupted cached installer");
    fixture.requests.length = 0;

    const second = fixture.start();
    await second.service.checkForUpdates();

    expect(second.service.getState()).toMatchObject({ status: "downloaded", error: null });
    expect(await readFile(second.updater.installerPath)).toEqual(fixture.payload);
    expect(fixture.requests).toEqual(corrupted
      ? [fixture.metadataPath, fixture.artifactPath]
      : [fixture.metadataPath]);
    expect(second.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it.each([
    ["1.3.9", "not-available", null],
    ["1.4.0", "not-available", null],
    ["1.4.1-internal.1", "error", "The update feed returned an invalid or cross-channel version."],
  ])("never downloads or installs rejected Stable candidate %s", async (candidateVersion, status, error) => {
    const fixture = await createFixture({ candidateVersion });
    const { service, updater } = fixture.start();

    await service.checkForUpdates();
    await service.installDownloadedUpdate();

    expect(service.getState()).toMatchObject({ status, availableVersion: null, error });
    expect(fixture.requests).toEqual([fixture.metadataPath]);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.installerPath).toBeNull();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("does not auto-install on abnormal exit, and installs the verified file once on normal exit", async () => {
    const fixture = await createFixture();
    const { service, updater, quitHandlers } = fixture.start();
    await service.checkForUpdates();
    expect(quitHandlers).toHaveLength(1);

    quitHandlers[0](1);
    expect(updater.spawnLog).not.toHaveBeenCalled();
    quitHandlers[0](0);
    quitHandlers[0](0);
    expect(updater.spawnLog).toHaveBeenCalledExactlyOnceWith(updater.installerPath, ["--updated", "/S"]);
  });

  it("falls back to a verified full installer when differential block maps are unavailable", async () => {
    const fixture = await createFixture();
    const { service, updater } = fixture.start({ differentialDownload: true });
    await service.checkForUpdates();

    expect(service.getState()).toMatchObject({ status: "downloaded", error: null });
    expect(fixture.requests).toEqual([
      fixture.metadataPath, `${fixture.artifactPath}.blockmap`, fixture.artifactPath,
    ]);
    expect(await readFile(updater.installerPath)).toEqual(fixture.payload);
  });

  it("rejects an installer rejected by the signature verifier and allows a corrected retry", async () => {
    const fixture = await createFixture({ publisherName: "PuppyOne Test Publisher" });
    const { service, updater } = fixture.start();
    const verifySignature = vi.fn().mockResolvedValueOnce("publisher mismatch").mockResolvedValue(null);
    // The OS trust decision is simulated; NsisUpdater's rejection and cleanup are real.
    updater.verifyUpdateCodeSignature = verifySignature;

    await service.checkForUpdates();
    expect(service.getState()).toMatchObject({ status: "error", error: expect.stringContaining("publisher mismatch") });
    expect(verifySignature).toHaveBeenCalledWith(["PuppyOne Test Publisher"], expect.any(String));
    expect(updater.installerPath).toBeNull();
    await service.installDownloadedUpdate();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    await service.checkForUpdates();
    expect(service.getState()).toMatchObject({ status: "downloaded", error: null });
    expect(verifySignature).toHaveBeenCalledTimes(2);
    expect(await readFile(updater.installerPath)).toEqual(fixture.payload);
  });
});

async function createFixture(overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "puppyone-updater-delivery-"));
  const payload = Buffer.from("PuppyOne installer download fixture\n".repeat(8192));
  const response = {
    candidateVersion: "1.4.1", metadataStatus: 200, artifactStatus: 200, corruptPayload: false, ...overrides,
  };
  const metadataPath = "/desktop/stable/windows/x64/nsis/latest/stable.yml";
  const filename = `puppyone-${response.candidateVersion}-x64-setup.exe`;
  const artifactPath = `/desktop/stable/windows/x64/nsis/latest/${filename}`;
  const requests = [];
  const services = [];
  const checksum = createHash("sha512").update(payload).digest("base64");
  const server = createServer((incoming, outgoing) => {
    const pathname = new URL(incoming.url, "http://localhost").pathname;
    requests.push(pathname);
    if (pathname === metadataPath) {
      outgoing.writeHead(response.metadataStatus, { "Content-Type": "text/yaml" });
      outgoing.end(response.invalidMetadata ? "files: [unterminated" : dump({
        version: response.candidateVersion,
        files: [{ url: filename, sha512: checksum, size: payload.length }],
        path: filename,
        sha512: checksum,
      }));
    } else if (pathname === artifactPath) {
      const body = response.corruptPayload ? Buffer.from("corrupted response") : payload;
      outgoing.writeHead(response.artifactStatus, { "Content-Type": "application/octet-stream", "Content-Length": body.length });
      if (response.interruptDownload) {
        outgoing.write(body.subarray(0, 1024), () => outgoing.destroy());
      } else {
        outgoing.end(body);
      }
    } else {
      outgoing.writeHead(404);
      outgoing.end("No update at this platform or channel path");
    }
  });
  const buildInfo = resolveDesktopBuildIdentity({
    baseVersion: "1.4.0", channel: "stable", buildNumber: 72, commitSha: "d".repeat(40),
  });
  const builder = createDesktopElectronBuilderConfig({
    packageMetadata: {}, buildInfo, target: { platform: "windows", arch: "x64" },
  });
  const appUpdateConfigPath = path.join(directory, "app-update.yml");
  const fixture = {
    payload, response, requests, metadataPath, artifactPath,
    start({ automaticallyDownloadUpdates = true, differentialDownload = false } = {}) {
      const quitHandlers = [];
      const states = [];
      const updater = new NsisUpdater(null, {
        name: "PuppyOne updater test", version: buildInfo.version, isPackaged: true,
        userDataPath: path.join(directory, "data"), baseCachePath: path.join(directory, "cache"),
        appUpdateConfigPath, whenReady: async () => {}, onQuit: (handler) => quitHandlers.push(handler), quit: vi.fn(),
      });
      // Select Windows metadata on all CI hosts without changing the actual
      // provider, version policy, download, checksum, cache or NSIS implementation.
      const runtimeOptions = updater.createProviderRuntimeOptions.bind(updater);
      updater.createProviderRuntimeOptions = () => ({ ...runtimeOptions(), platform: "win32" });
      updater.disableDifferentialDownload = !differentialDownload;
      updater.httpExecutor = new LoopbackHttpExecutor(server.address().port);
      // Never execute the fixture as an installer or quit the test process.
      // Explicit install is verified at this boundary; on-quit installation also
      // exercises NsisUpdater's actual installer-path and argument construction.
      updater.quitAndInstall = vi.fn();
      updater.spawnLog = vi.fn(async () => true);
      const service = createUpdateService({
        app: { isPackaged: true }, buildInfo, autoUpdater: updater,
        platform: "win32", arch: "x64", environment: {}, automaticallyDownloadUpdates,
        ipcMain: { handle: vi.fn() },
        getWindows: () => [{ isDestroyed: () => false, webContents: { send: (_channel, state) => states.push(state.status) } }],
      });
      services.push(service);
      service.start();
      updater.logger = null;
      return { service, updater, states, quitHandlers };
    },
    async dispose() {
      for (const service of services) service.dispose();
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      // Only this fixture's uniquely created temporary directory is removed.
      if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith("puppyone-updater-delivery-")) {
        throw new Error("Unexpected updater fixture directory");
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
  fixtures.push(fixture);
  await writeFile(appUpdateConfigPath, dump({
    ...builder.publish[0], updaterCacheDirName: "puppyone-update-test",
    ...(response.publisherName ? { publisherName: response.publisherName } : {}),
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return fixture;
}

class LoopbackHttpExecutor extends ElectronHttpExecutor {
  constructor(port) {
    super();
    this.port = port;
  }

  createRequest(options, callback) {
    if (options.hostname !== "updates.puppyone.ai") throw new Error(`Unexpected update origin: ${options.hostname}`);
    // Retain the real executor's redirects, stream handling and SHA-512 checks.
    // Only the socket transport is routed to our isolated HTTP fixture.
    return request({
      hostname: "127.0.0.1", port: this.port, path: options.path,
      method: options.method, headers: options.headers, agent: false,
    }, callback);
  }
}
