#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  jsonFile,
  sha256File,
  verifyDesktopReleaseBundle,
} from "./release-support/desktop-release-metadata.mjs";
import { createDesktopReleaseSet } from "../tooling/desktop/release/release-set.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const args = parseArguments(process.argv.slice(2));
  const expectedTag = required(args, "tag");
  const expectedCommit = required(args, "commit");
  const macosBundle = resolvePath(required(args, "macos-bundle"));
  const windowsBundle = resolvePath(required(args, "windows-bundle"));
  const output = resolvePath(required(args, "output"));

  const [{ manifest: macos }, { manifest: windows }] = await Promise.all([
    verifyDesktopReleaseBundle(macosBundle, {
      channel: "stable",
      tag: expectedTag,
      commitSha: expectedCommit,
      targetId: "macos-arm64",
    }),
    verifyDesktopReleaseBundle(windowsBundle, {
      channel: "stable",
      tag: expectedTag,
      commitSha: expectedCommit,
      targetId: "windows-x64",
    }),
  ]);

  assertSharedReleaseIdentity(macos, windows);
  assertUniqueAssetNames(macos, windows);

  const releaseIdentity = {
    schemaVersion: 1,
    product: macos.product,
    channel: macos.channel,
    baseVersion: macos.baseVersion,
    version: macos.version,
    buildId: macos.build.id,
    commitSha: macos.commitSha,
    builtAt: macos.build.builtAt,
    sourceDirty: macos.build.sourceDirty,
  };
  const releaseSet = createDesktopReleaseSet({
    releaseIdentity,
    targetBundles: [
      await createBundleDescriptor({
        target: "macos-arm64",
        artifactName: required(args, "macos-artifact"),
        bundleDirectory: macosBundle,
        manifest: macos,
        security: {
          kind: "apple",
          signed: macos.security.developerIdSigned,
          notarized: macos.security.notarized,
          stapled: macos.security.notarized,
        },
      }),
      await createBundleDescriptor({
        target: "windows-x64",
        artifactName: required(args, "windows-artifact"),
        bundleDirectory: windowsBundle,
        manifest: windows,
        security: windows.security,
      }),
    ],
  });

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, jsonFile(releaseSet), "utf8");
  console.log(`Created complete Desktop Stable Release Set for ${expectedTag} at ${output}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function createBundleDescriptor({ target, artifactName, bundleDirectory, manifest, security }) {
  return {
    target,
    artifactName,
    bundleSha256: await hashBundle(bundleDirectory),
    releaseManifestSha256: await sha256File(path.join(bundleDirectory, "release.json")),
    assetCount: manifest.assets.length,
    security,
  };
}

async function hashBundle(bundleDirectory) {
  const relativeFiles = await listFiles(bundleDirectory);
  const hash = createHash("sha256");
  for (const relativeFile of relativeFiles) {
    hash.update(relativeFile);
    hash.update("\0");
    hash.update(await sha256File(path.join(bundleDirectory, relativeFile)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function listFiles(directory, relative = "") {
  const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const next = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(directory, next));
    else if (entry.isFile()) files.push(next);
    else throw new Error(`Release bundle contains a non-file entry: ${next}`);
  }
  return files;
}

function assertSharedReleaseIdentity(macos, windows) {
  const sharedPaths = [
    ["product"],
    ["channel"],
    ["tag"],
    ["version"],
    ["baseVersion"],
    ["commitSha"],
    ["publishedAt"],
    ["build", "id"],
    ["build", "builtAt"],
    ["build", "sourceDirty"],
    ["promotion", "sourceChannel"],
    ["promotion", "sourceTag"],
    ["source", "repository"],
  ];
  for (const segments of sharedPaths) {
    const macosValue = readPath(macos, segments);
    const windowsValue = readPath(windows, segments);
    if (macosValue !== windowsValue) {
      throw new Error(`Stable target bundles disagree on ${segments.join(".")}.`);
    }
  }
}

function assertUniqueAssetNames(...manifests) {
  const owners = new Map();
  for (const manifest of manifests) {
    const targetId = manifest.target?.id ?? "macos-arm64";
    for (const asset of manifest.assets) {
      const owner = owners.get(asset.name);
      if (owner) throw new Error(`Release asset ${asset.name} collides between ${owner} and ${targetId}.`);
      owners.set(asset.name, targetId);
    }
  }
}

function readPath(value, segments) {
  return segments.reduce((current, segment) => current?.[segment], value);
}

function parseArguments(values) {
  const args = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key ?? "end of input"}`);
    args.set(key.slice(2), value);
  }
  return args;
}

function required(args, key) {
  const value = args.get(key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

function resolvePath(value) {
  return path.resolve(repositoryRoot, value);
}
