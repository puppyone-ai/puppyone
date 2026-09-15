import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveMatches, runtimeDownloadUrl } from "../../../../../scripts/prepare-opencode-dev-runtime.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true }))));

describe("OpenCode development runtime preparation", () => {
  it("constructs only the pinned allowlisted release URL", () => {
    const manifest = { repository: "https://github.com/anomalyco/opencode", runtimeRelease: { version: "1.17.18" } };
    expect(runtimeDownloadUrl(manifest, { archive: "opencode-darwin-arm64.zip" }))
      .toBe("https://github.com/anomalyco/opencode/releases/download/v1.17.18/opencode-darwin-arm64.zip");
    expect(() => runtimeDownloadUrl({ ...manifest, repository: "https://example.com/runtime" }, { archive: "runtime.zip" }))
      .toThrow(/not allowlisted/i);
  });

  it("reuses a cached archive only when size and SHA-256 match", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "puppyone-opencode-cache-"));
    roots.push(root);
    const archivePath = path.join(root, "runtime.zip");
    const content = Buffer.from("verified runtime archive");
    const artifact = { bytes: content.byteLength, sha256: crypto.createHash("sha256").update(content).digest("hex") };
    await fs.promises.writeFile(archivePath, content);
    await expect(archiveMatches(archivePath, artifact)).resolves.toBe(true);
    await fs.promises.appendFile(archivePath, "tampered");
    await expect(archiveMatches(archivePath, artifact)).resolves.toBe(false);
  });
});
