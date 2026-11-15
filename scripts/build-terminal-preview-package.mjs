#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertDesktopBuildInfo,
  createDesktopBuildTag,
  getDesktopBuildChannelPolicy,
} from "../shared/desktop-build-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildTerminalPreviewPackage({
  root = repoRoot,
  arch = process.arch,
  archivePath,
  archiveUrl,
  buildInfoPath = path.join(root, "generated", "desktop-build-info.json"),
  packageVersion,
  releaseTag,
  outputDirectory = path.join(root, "artifacts", "terminal-preview"),
} = {}) {
  if (process.platform !== "darwin") {
    throw new Error("Terminal preview packages must be built on macOS.");
  }
  if (!["arm64", "x64"].includes(arch)) {
    throw new Error(`Unsupported terminal preview architecture: ${arch}`);
  }

  const rootPackage = JSON.parse(
    await fs.promises.readFile(path.join(root, "package.json"), "utf8"),
  );
  const buildInfo = assertDesktopBuildInfo(JSON.parse(
    await fs.promises.readFile(path.resolve(root, buildInfoPath), "utf8"),
  ));
  const channelPolicy = getDesktopBuildChannelPolicy(buildInfo.channel);
  const canonicalTag = createDesktopBuildTag(buildInfo);
  if (releaseTag && releaseTag !== canonicalTag) {
    throw new Error(`Terminal package release tag ${releaseTag} does not match ${canonicalTag}.`);
  }
  const resolvedArchivePath = archivePath
    ? path.resolve(root, archivePath)
    : await findReleaseArchive({ root, version: buildInfo.version, arch });
  const archiveStat = await fs.promises.stat(resolvedArchivePath).catch(() => null);
  if (!archiveStat?.isFile()) {
    throw new Error(`No macOS ZIP release archive exists at ${resolvedArchivePath}.`);
  }

  const resolvedPackageVersion = normalizePackageVersion(
    packageVersion || buildInfo.version,
  );
  const resolvedArchiveUrl = archiveUrl || pathToFileURL(resolvedArchivePath).href;
  const archiveSha256 = await hashFile(resolvedArchivePath);
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "puppyone-terminal-preview-"),
  );
  const packageRoot = path.join(temporaryDirectory, "package");
  const binDirectory = path.join(packageRoot, "bin");

  try {
    await fs.promises.mkdir(binDirectory, { recursive: true });
    await fs.promises.copyFile(
      path.join(root, "scripts", "terminal-preview-launcher.mjs"),
      path.join(binDirectory, "puppyone-preview.mjs"),
    );
    await fs.promises.chmod(path.join(binDirectory, "puppyone-preview.mjs"), 0o755);

    const packageJson = {
      name: "@puppyone/desktop-terminal-preview",
      version: resolvedPackageVersion,
      description: "Temporary Terminal-launched preview of the PuppyOne macOS desktop app.",
      license: "Apache-2.0",
      type: "module",
      bin: {
        "puppyone-preview": "bin/puppyone-preview.mjs",
      },
      engines: {
        node: ">=18.17",
      },
      os: ["darwin"],
      cpu: [arch],
      files: [
        "bin/",
        "README.md",
      ],
      puppyoneTerminalPreview: {
        appVersion: buildInfo.version,
        buildChannel: buildInfo.channel,
        buildId: buildInfo.buildId,
        commitSha: buildInfo.commitSha,
        arch,
        archiveUrl: resolvedArchiveUrl,
        archiveBytes: archiveStat.size,
        archiveSha256,
        allowedArchiveHost: new URL(resolvedArchiveUrl).protocol === "https:"
          ? new URL(resolvedArchiveUrl).hostname
          : undefined,
        appBundleName: `${channelPolicy.applicationName}.app`,
        executableRelativePath: `Contents/MacOS/${
          buildInfo.runtime === "gpui"
            ? "puppy-one-rust"
            : (rootPackage.build?.mac?.executableName || "puppyone")
        }`,
        releaseTag: releaseTag || canonicalTag,
      },
    };
    await fs.promises.writeFile(
      path.join(packageRoot, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );
    await fs.promises.writeFile(
      path.join(packageRoot, "README.md"),
      createReadme({
        appVersion: buildInfo.version,
        arch,
        releaseTag,
      }),
    );

    await fs.promises.mkdir(outputDirectory, { recursive: true });
    const packResult = spawnSync(
      "npm",
      ["pack", packageRoot, "--json", "--pack-destination", outputDirectory],
      {
        cwd: root,
        encoding: "utf8",
        shell: false,
      },
    );
    if (packResult.status !== 0) {
      throw new Error(
        `npm pack failed: ${(packResult.stderr || packResult.stdout || "unknown error").trim()}`,
      );
    }
    const packed = JSON.parse(packResult.stdout);
    const artifactName = packed?.[0]?.filename;
    if (!artifactName) throw new Error("npm pack did not report a preview artifact.");
    const artifactPath = path.join(outputDirectory, artifactName);
    const artifactStat = await fs.promises.stat(artifactPath);
    const summary = {
      appVersion: buildInfo.version,
      buildChannel: buildInfo.channel,
      buildId: buildInfo.buildId,
      commitSha: buildInfo.commitSha,
      arch,
      archivePath: resolvedArchivePath,
      archiveUrl: resolvedArchiveUrl,
      archiveBytes: archiveStat.size,
      archiveSha256,
      packageVersion: resolvedPackageVersion,
      packagePath: artifactPath,
      packageBytes: artifactStat.size,
      releaseTag: releaseTag || canonicalTag,
    };
    await fs.promises.writeFile(
      path.join(outputDirectory, "terminal-preview.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    return summary;
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export function normalizePackageVersion(value) {
  const normalized = String(value || "").trim().replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`Invalid terminal preview package version: ${value}`);
  }
  return normalized;
}

async function findReleaseArchive({ root, version, arch }) {
  const releaseDirectory = path.join(root, "release");
  const expectedNames = [
    `puppyone-${version}-${arch}-mac.zip`,
    `puppyone-${version}-${arch}.zip`,
  ];
  for (const filename of expectedNames) {
    const candidate = path.join(releaseDirectory, filename);
    const stat = await fs.promises.stat(candidate).catch(() => null);
    if (stat?.isFile()) return candidate;
  }
  const entries = await fs.promises.readdir(releaseDirectory).catch(() => []);
  const matching = entries.filter((entry) => (
    entry.endsWith(".zip")
    && entry.includes(`-${version}-`)
    && entry.includes(`-${arch}`)
  ));
  if (matching.length !== 1) {
    throw new Error(
      `Expected one ${arch} macOS ZIP in ${releaseDirectory}, found ${matching.length}. Run npm run dist:mac first.`,
    );
  }
  return path.join(releaseDirectory, matching[0]);
}

async function hashFile(filename) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

function createReadme({ appVersion, arch, releaseTag }) {
  return `# PuppyOne Terminal Preview

Temporary, ad-hoc signed and non-notarized macOS preview for technical testers
while the Developer ID release is being provisioned.

- App version: ${appVersion}
- Architecture: ${arch}
${releaseTag ? `- Release tag: ${releaseTag}\n` : ""}

Run the package through the exact HTTPS tarball URL supplied by PuppyOne:

\`\`\`bash
npm exec --yes --package="<preview-package-url>" -- puppyone-preview
\`\`\`

The launcher downloads the immutable PuppyOne ZIP declared by this package,
verifies its byte size and SHA-256 digest, extracts it into the current user's
cache directory, and starts the packaged Electron app in the foreground.

This preview is not Developer ID signed or notarized. It is not the permanent
public installation path and will be replaced by the signed DMG release.
`;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    index += 1;
    if (key === "arch") options.arch = value;
    else if (key === "archive") options.archivePath = value;
    else if (key === "archive-url") options.archiveUrl = value;
    else if (key === "build-info") options.buildInfoPath = value;
    else if (key === "package-version") options.packageVersion = value;
    else if (key === "release-tag") options.releaseTag = value;
    else if (key === "output") options.outputDirectory = path.resolve(repoRoot, value);
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

async function main() {
  const summary = await buildTerminalPreviewPackage(parseArguments(process.argv.slice(2)));
  console.log(`Terminal preview package created: ${summary.packagePath}`);
  console.log(`App archive SHA-256: ${summary.archiveSha256}`);
}

if (
  process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
