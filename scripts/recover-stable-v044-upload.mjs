#!/usr/bin/env node
// Deliberately pinned incident repair, not an alternative publisher.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sha256File, verifyDesktopReleaseBundle } from "./release-support/desktop-release-metadata.mjs";
import { recoverImmutableUploads } from "./release-support/immutable-upload-recovery.mjs";

const tag = "v0.4.4";
const commitSha = "5e87974efcfae0c9a83801ccc9add2f2deceb395";
const runUrl = "https://github.com/puppyone-ai/puppyone/actions/runs/43074642375";
const bucket = "puppyone-desktop";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!/^[a-f0-9]{32}$/.test(accountId ?? "")) throw new Error("A valid R2 account is required.");
const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-v044-recovery-"));
const aws = (args) => execFileSync("aws", ["s3api", ...args, "--bucket", bucket, "--endpoint-url", endpoint],
  { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 300_000 });
const store = {
  async list(prefix) {
    const response = JSON.parse(aws(["list-objects-v2", "--prefix", prefix, "--output", "json"]));
    return (response.Contents ?? []).map(({ Key }) => Key);
  },
  async digest(key) {
    const file = path.join(scratch, "remote-object");
    aws(["get-object", "--key", key, file]);
    return { bytes: (await fs.stat(file)).size, sha256: await sha256File(file) };
  },
  async putMissing(key, file) {
    // Single PUT avoids the failed multipart completion. Conditional creation
    // also protects against another writer appearing after the preflight.
    aws(["put-object", "--key", key, "--body", file, "--if-none-match", "*",
      "--cache-control", "public, max-age=31536000, immutable",
      "--content-type", key.endsWith(".json") ? "application/json" : "application/octet-stream"]);
  },
};

try {
  const setPrefix = `desktop/stable/release-sets/${tag}/`;
  if ((await store.list(setPrefix)).length) throw new Error("Release Set already committed; recovery refused.");
  const bundles = [];
  for (const [targetId, directory, prefix] of [
    ["macos-arm64", "artifacts/recovery/puppyone-desktop-v0.4.4", "desktop/stable/mac/v0.4.4"],
    ["windows-x64", "artifacts/recovery/puppyone-desktop-v0.4.4-windows-x64", "desktop/stable/windows/v0.4.4/x64"],
  ]) {
    const { manifest } = await verifyDesktopReleaseBundle(directory, { channel: "stable", tag, commitSha, targetId });
    if (manifest.r2.prefix !== prefix || manifest.source.workflowRunUrl !== runUrl
      || manifest.promotion.sourceTag !== "v0.4.4-internal.57" || manifest.build.sourceDirty !== false) {
      throw new Error(`Bundle does not belong to the pinned v0.4.4 incident: ${targetId}`);
    }
    const entries = manifest.assets.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256,
      path: path.join(directory, "assets", name) }));
    for (const name of ["SHA256SUMS", "build-info.json", "release.json"]) {
      const file = path.join(directory, name);
      entries.push({ name, path: file, bytes: (await fs.stat(file)).size, sha256: await sha256File(file) });
    }
    bundles.push({ prefix, files: entries });
  }
  await recoverImmutableUploads({ bundles, store });
  console.log("Original v0.4.4 bundles recovered. Rerun only the original failed publisher job.");
} finally {
  await fs.rm(scratch, { recursive: true });
}
