import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTerminalDownloadProgress,
  preparePreviewApp,
  validatePreviewMetadata,
} from "../../../../scripts/terminal-preview-launcher.mjs";
import { normalizePackageVersion } from "../../../../scripts/build-terminal-preview-package.mjs";

const temporaryDirectories = [];
const macIntegrationIt = process.platform === "darwin" ? it : it.skip;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => (
      fs.promises.rm(directory, { recursive: true, force: true })
    )),
  );
});

describe("Terminal preview launcher", () => {
  macIntegrationIt("extracts a verified app archive and reuses the prepared cache", async () => {
    const fixture = await createPreviewFixture();
    const cacheRoot = path.join(fixture.root, "cache");
    const first = await preparePreviewApp({
      cacheRoot,
      metadata: fixture.metadata,
      log: { info() {} },
    });

    expect(first.reused).toBe(false);
    expect(await fs.promises.readFile(first.executablePath, "utf8")).toContain("#!/bin/sh");

    const second = await preparePreviewApp({
      cacheRoot,
      metadata: fixture.metadata,
      log: { info() {} },
    });
    expect(second.reused).toBe(true);
    expect(second.executablePath).toBe(first.executablePath);
  });

  macIntegrationIt("rejects archives whose digest does not match the package metadata", async () => {
    const fixture = await createPreviewFixture();
    await expect(preparePreviewApp({
      cacheRoot: path.join(fixture.root, "bad-cache"),
      metadata: {
        ...fixture.metadata,
        archiveSha256: "0".repeat(64),
      },
      log: { info() {} },
    })).rejects.toThrow(/SHA-256 verification/i);
  });

  macIntegrationIt("accepts an HTTPS response without a Content-Length header", async () => {
    const fixture = await createPreviewFixture();
    const progress = [];
    const prepared = await preparePreviewApp({
      cacheRoot: path.join(fixture.root, "https-cache"),
      metadata: {
        ...fixture.metadata,
        archiveUrl: "https://downloads.puppyone.ai/preview.zip",
      },
      fetchImpl: async () => new Response(fixture.archive),
      log: { info() {} },
      onDownloadProgress: (event) => progress.push(event),
    });

    expect(prepared.reused).toBe(false);
    expect(await fs.promises.stat(prepared.executablePath)).toMatchObject({
      mode: expect.any(Number),
    });
    expect(progress[0]).toEqual({
      downloadedBytes: 0,
      percent: 0,
      totalBytes: fixture.archive.byteLength,
    });
    expect(progress.at(-1)).toEqual({
      downloadedBytes: fixture.archive.byteLength,
      percent: 100,
      totalBytes: fixture.archive.byteLength,
    });
  });

  it("renders live terminal progress and bounded milestone output", () => {
    let terminalOutput = "";
    const terminalProgress = createTerminalDownloadProgress({
      label: "Downloading test…",
      stream: {
        isTTY: true,
        write(value) {
          terminalOutput += value;
        },
      },
    });
    terminalProgress.update({
      downloadedBytes: 0,
      percent: 0,
      totalBytes: 100,
    });
    terminalProgress.update({
      downloadedBytes: 100,
      percent: 100,
      totalBytes: 100,
    });
    terminalProgress.stop();

    expect(terminalOutput).toContain("\r\u001b[2KDownloading test… 0% (0 B / 100 B)");
    expect(terminalOutput).toContain("\r\u001b[2KDownloading test… 100% (100 B / 100 B)\n");

    let logOutput = "";
    const logProgress = createTerminalDownloadProgress({
      label: "Downloading test…",
      stream: {
        isTTY: false,
        write(value) {
          logOutput += value;
        },
      },
    });
    for (const percent of [0, 4, 47, 49, 100]) {
      logProgress.update({
        downloadedBytes: percent,
        percent,
        totalBytes: 100,
      });
    }
    logProgress.stop();

    expect(logOutput).toBe(
      "Downloading test… 0% (0 B / 100 B)\n"
      + "Downloading test… 47% (47 B / 100 B)\n"
      + "Downloading test… 100% (100 B / 100 B)\n",
    );
  });

  it("rejects insecure URLs and paths that escape the app bundle", () => {
    const metadata = createMetadata({
      archiveUrl: "http://downloads.puppyone.ai/preview.zip",
    });
    expect(() => validatePreviewMetadata(metadata)).toThrow(/HTTPS/i);
    expect(() => validatePreviewMetadata({
      ...metadata,
      archiveUrl: "https://downloads.puppyone.ai/preview.zip",
      executableRelativePath: "../outside",
    })).toThrow(/inside the app bundle/i);
  });

  it("normalizes release tags into npm-compatible versions", () => {
    expect(normalizePackageVersion("v0.1.2-internal.42")).toBe("0.1.2-internal.42");
    expect(() => normalizePackageVersion("preview-latest")).toThrow(/invalid/i);
  });
});

async function createPreviewFixture() {
  const root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "puppyone-terminal-preview-test-"),
  );
  temporaryDirectories.push(root);
  const sourceRoot = path.join(root, "source");
  const appRoot = path.join(sourceRoot, "puppyone.app");
  const executablePath = path.join(appRoot, "Contents", "MacOS", "puppyone");
  await fs.promises.mkdir(path.dirname(executablePath), { recursive: true });
  await fs.promises.writeFile(executablePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.promises.writeFile(
    path.join(appRoot, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>puppyone</string>
  <key>CFBundleIdentifier</key>
  <string>ai.puppyone.desktop.test</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
</dict>
</plist>
`,
  );
  const signResult = spawnSync(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appRoot],
    { encoding: "utf8" },
  );
  if (signResult.status !== 0) {
    throw new Error(signResult.stderr || "Unable to ad-hoc sign terminal preview fixture.");
  }

  const archivePath = path.join(root, "puppyone.zip");
  const result = spawnSync(
    "/usr/bin/ditto",
    ["-c", "-k", "--sequesterRsrc", "--keepParent", appRoot, archivePath],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "Unable to create terminal preview fixture.");
  }
  const archive = await fs.promises.readFile(archivePath);
  return {
    archive,
    root,
    metadata: createMetadata({
      archiveUrl: pathToFileURL(archivePath).href,
      archiveBytes: archive.byteLength,
      archiveSha256: crypto.createHash("sha256").update(archive).digest("hex"),
    }),
  };
}

function createMetadata(overrides = {}) {
  return {
    appVersion: "0.1.2",
    packageVersion: "0.1.2-preview.0",
    arch: process.arch,
    archiveUrl: pathToFileURL("/tmp/puppyone-preview.zip").href,
    archiveBytes: 123,
    archiveSha256: "a".repeat(64),
    appBundleName: "puppyone.app",
    executableRelativePath: "Contents/MacOS/puppyone",
    ...overrides,
  };
}
