#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACK_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}(?:\.[a-z0-9][a-z0-9-]{0,62})+$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function verifyLocalViewerPacks(packsDir, { requireNonEmpty = false } = {}) {
  const resolvedDir = path.resolve(packsDir);
  const entries = await fs.readdir(resolvedDir, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT" && !requireNonEmpty) return [];
    throw error;
  });
  const manifestFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".manifest.json"))
    .map((entry) => entry.name)
    .sort();

  if (manifestFiles.length === 0) {
    if (requireNonEmpty) {
      throw new Error(`No *.manifest.json viewer pack descriptors found in ${resolvedDir}`);
    }
    return [];
  }

  const verified = [];
  for (const manifestFile of manifestFiles) {
    const manifestPath = path.join(resolvedDir, manifestFile);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (manifest?.schemaVersion !== 1) {
      throw new Error(`${manifestFile}: schemaVersion must be 1`);
    }
    if (!PACK_ID_PATTERN.test(String(manifest.id ?? ""))) {
      throw new Error(`${manifestFile}: invalid pack id ${manifest.id}`);
    }
    if (!VERSION_PATTERN.test(String(manifest.version ?? ""))) {
      throw new Error(`${manifestFile}: invalid semantic version ${manifest.version}`);
    }
    if (!SHA256_PATTERN.test(String(manifest.sha256 ?? ""))) {
      throw new Error(`${manifestFile}: invalid sha256 digest`);
    }
    const expectedArchive = `${manifest.id}-${manifest.version}.tar.gz`;
    const expectedChecksum = `${manifest.id}-${manifest.version}.sha256`;
    if (manifest.archive !== expectedArchive) {
      throw new Error(`${manifestFile}: archive must be ${expectedArchive}`);
    }
    if (manifest.checksum !== expectedChecksum) {
      throw new Error(`${manifestFile}: checksum must be ${expectedChecksum}`);
    }

    const archivePath = path.join(resolvedDir, expectedArchive);
    const checksumPath = path.join(resolvedDir, expectedChecksum);
    const archiveBytes = await fs.readFile(archivePath);
    if (archiveBytes.byteLength !== manifest.size) {
      throw new Error(
        `${manifestFile}: size mismatch (${archiveBytes.byteLength} !== ${manifest.size})`,
      );
    }
    const actualSha256 = sha256Buffer(archiveBytes);
    if (actualSha256 !== manifest.sha256) {
      throw new Error(
        `${manifestFile}: archive sha256 mismatch (${actualSha256} !== ${manifest.sha256})`,
      );
    }
    const checksumText = (await fs.readFile(checksumPath, "utf8")).trim();
    if (checksumText !== `${manifest.sha256}  ${expectedArchive}`) {
      throw new Error(`${manifestFile}: checksum file does not match manifest digest`);
    }

    verified.push({
      id: manifest.id,
      version: manifest.version,
      archive: expectedArchive,
      checksum: expectedChecksum,
      manifestFile,
      archivePath,
      checksumPath,
      manifestPath,
      sha256: manifest.sha256,
      size: manifest.size,
      r2Prefix: `desktop/viewer-packs/${manifest.id}/${manifest.version}`,
    });
  }
  return verified;
}

export async function publishViewerPacksToR2({
  packsDir,
  bucket,
  endpoint,
  publicOrigin,
  requireNonEmpty = false,
  runAws = defaultRunAws,
  fetchImpl = globalThis.fetch,
}) {
  const packs = await verifyLocalViewerPacks(packsDir, { requireNonEmpty });
  if (packs.length === 0) return [];

  const normalizedOrigin = String(publicOrigin).replace(/\/+$/, "");
  for (const pack of packs) {
    const archiveKey = `${pack.r2Prefix}/${pack.archive}`;
    const alreadyUploaded = runAws([
      "s3api",
      "head-object",
      "--bucket",
      bucket,
      "--key",
      archiveKey,
      "--endpoint-url",
      endpoint,
    ], { allowFailure: true });

    if (!alreadyUploaded) {
      runAws([
        "s3",
        "cp",
        pack.archivePath,
        `s3://${bucket}/${archiveKey}`,
        "--endpoint-url",
        endpoint,
        "--content-type",
        "application/gzip",
        "--cache-control",
        IMMUTABLE_CACHE_CONTROL,
        "--only-show-errors",
      ]);
      runAws([
        "s3",
        "cp",
        pack.checksumPath,
        `s3://${bucket}/${pack.r2Prefix}/${pack.checksum}`,
        "--endpoint-url",
        endpoint,
        "--content-type",
        "text/plain; charset=utf-8",
        "--cache-control",
        IMMUTABLE_CACHE_CONTROL,
        "--only-show-errors",
      ]);
      runAws([
        "s3",
        "cp",
        pack.manifestPath,
        `s3://${bucket}/${pack.r2Prefix}/${pack.manifestFile}`,
        "--endpoint-url",
        endpoint,
        "--content-type",
        "application/json; charset=utf-8",
        "--cache-control",
        IMMUTABLE_CACHE_CONTROL,
        "--only-show-errors",
      ]);
    }

    const publicUrl = `${normalizedOrigin}/${archiveKey}`;
    const response = await fetchImpl(publicUrl, { redirect: "error" });
    if (!response.ok) {
      throw new Error(`Published viewer pack ${publicUrl} returned HTTP ${response.status}`);
    }
    const remoteBytes = Buffer.from(await response.arrayBuffer());
    if (remoteBytes.byteLength !== pack.size) {
      throw new Error(
        `Published viewer pack ${publicUrl} byte length ${remoteBytes.byteLength} !== ${pack.size}`,
      );
    }
    const remoteSha256 = sha256Buffer(remoteBytes);
    if (remoteSha256 !== pack.sha256) {
      throw new Error(
        `Published viewer pack ${publicUrl} sha256 ${remoteSha256} !== ${pack.sha256}`,
      );
    }
  }
  return packs;
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function defaultRunAws(args, { allowFailure = false } = {}) {
  try {
    execFileSync("aws", args, { stdio: allowFailure ? "ignore" : "inherit" });
    return true;
  } catch (error) {
    if (allowFailure) return false;
    throw error;
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    if (key === "require-non-empty") {
      options.set(key, "true");
      continue;
    }
    const value = rest[index + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options.set(key, value);
    index += 1;
  }
  return { command, options };
}

function requiredOption(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    const { command, options } = parseArgs(process.argv.slice(2));
    const packsDir = requiredOption(options, "packs-dir");
    const requireNonEmpty = options.get("require-non-empty") === "true";
    if (command === "verify-local") {
      const packs = await verifyLocalViewerPacks(packsDir, { requireNonEmpty });
      console.log(`Verified ${packs.length} local viewer pack(s) in ${packsDir}`);
    } else if (command === "publish") {
      const packs = await publishViewerPacksToR2({
        packsDir,
        bucket: requiredOption(options, "bucket"),
        endpoint: requiredOption(options, "endpoint"),
        publicOrigin: requiredOption(options, "public-origin"),
        requireNonEmpty,
      });
      console.log(`Published and verified ${packs.length} viewer pack(s) on R2 CDN`);
    } else {
      throw new Error(`Unknown command ${command ?? "<none>"} (expected verify-local or publish)`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
