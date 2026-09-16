#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import {
  sha256File,
  verifyDesktopReleaseBundle,
} from "./release-support/desktop-release-metadata.mjs";

try {
  const args = parseArguments(process.argv.slice(2));
  const bundleDirectory = path.resolve(required(args, "bundle"));
  const releaseResponse = JSON.parse(await fs.readFile(path.resolve(required(args, "release-json")), "utf8"));
  const expectDraft = booleanOption(args, "expect-draft");
  const allowExtraAssets = optionalBoolean(args, "allow-extra-assets", false);
  const allowCompanionTargets = optionalBoolean(args, "allow-companion-targets", false);
  const includeMetadata = optionalBoolean(args, "include-metadata", true);
  const { manifest } = await verifyDesktopReleaseBundle(bundleDirectory);
  if (releaseResponse.tag_name !== manifest.tag) {
    throw new Error(`GitHub release tag mismatch: expected ${manifest.tag}, received ${releaseResponse.tag_name}`);
  }
  if (releaseResponse.draft !== expectDraft) {
    throw new Error(`GitHub release draft state mismatch: expected ${expectDraft}, received ${releaseResponse.draft}`);
  }
  if (releaseResponse.prerelease !== manifest.prerelease) {
    throw new Error(`GitHub prerelease state does not match release.json`);
  }

  const expectedFiles = new Map();
  for (const asset of manifest.assets) {
    expectedFiles.set(asset.name, { bytes: asset.bytes, sha256: asset.sha256 });
  }
  if (includeMetadata) {
    for (const name of ["release.json", "SHA256SUMS", "build-info.json"]) {
      const filePath = path.join(bundleDirectory, name);
      const stats = await fs.stat(filePath).catch((error) => {
        if (error?.code === "ENOENT" && name === "build-info.json") return null;
        throw error;
      });
      if (!stats) continue;
      expectedFiles.set(name, { bytes: stats.size, sha256: await sha256File(filePath) });
    }
  }
  const githubAssets = new Map((releaseResponse.assets ?? []).map((asset) => [asset.name, asset]));
  const errors = [];
  for (const [name, expected] of expectedFiles) {
    const actual = githubAssets.get(name);
    if (!actual) {
      errors.push(`missing GitHub asset ${name}`);
      continue;
    }
    if (actual.size !== expected.bytes) errors.push(`${name} byte length differs`);
    if (actual.digest !== `sha256:${expected.sha256}`) {
      errors.push(`${name} digest differs or is unavailable`);
    }
  }
  for (const name of githubAssets.keys()) {
    const optionalBackfillMetadata = !includeMetadata
      && ["release.json", "SHA256SUMS", "build-info.json"].includes(name);
    const companionTargetAsset = allowCompanionTargets && (
      /^puppyone-[0-9A-Za-z.-]+-x64-setup\.exe(?:\.blockmap)?$/.test(name)
      || /^(?:internal|stable)\.yml$/.test(name)
    );
    if (!allowExtraAssets && !expectedFiles.has(name) && !optionalBackfillMetadata && !companionTargetAsset) {
      errors.push(`unexpected GitHub asset ${name}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`GitHub release asset verification failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
  console.log(`Verified ${expectedFiles.size} GitHub release assets for ${manifest.tag}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArguments(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key ?? "end of input"}`);
    result.set(key.slice(2), value);
  }
  return result;
}

function required(args, key) {
  const value = args.get(key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

function booleanOption(args, key) {
  const value = required(args, key);
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`--${key} must be true or false`);
}

function optionalBoolean(args, key, fallback) {
  const value = args.get(key);
  if (value == null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`--${key} must be true or false`);
}
