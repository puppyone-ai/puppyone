import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertDesktopBuildInfo,
  createDesktopBuildR2Prefix,
  createDesktopBuildReleaseName,
  createDesktopBuildTag,
  resolveDesktopBuildIdentity,
} from "../../shared/desktop-build-identity.mjs";
import { createDesktopImmutableReleasePrefix } from "../../shared/desktop/distribution-contract.mjs";
import { createDesktopTargetFromNode } from "../../shared/desktop/platform-contract.mjs";
import {
  createDesktopElectronBuilderConfig as createTargetDesktopElectronBuilderConfig,
} from "../../tooling/desktop/build/create-builder-config.mjs";
import { getDesktopTargetDefinition } from "../../tooling/desktop/targets/target-manifest.mjs";
import { repairNodePtyPermissions } from "../node-pty-permissions.mjs";

export const DEFAULT_BUILD_INFO_PATH = "generated/desktop-build-info.json";
export const DEFAULT_BUILDER_CONFIG_PATH = "generated/electron-builder.json";

export async function prepareDesktopBuild({
  repositoryRoot,
  channel,
  buildNumber = null,
  commitSha = null,
  builtAt = null,
  sourceDirty = null,
  expectedTag = null,
  buildInfoPath = DEFAULT_BUILD_INFO_PATH,
  builderConfigPath = DEFAULT_BUILDER_CONFIG_PATH,
  target = null,
} = {}) {
  const root = path.resolve(repositoryRoot ?? process.cwd());
  repairNodePtyPermissions(root);
  const packageMetadata = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  const resolvedCommitSha = commitSha ?? readGitCommit(root);
  const resolvedSourceDirty = sourceDirty ?? readGitDirty(root);
  const buildInfo = resolveDesktopBuildIdentity({
    baseVersion: packageMetadata.version,
    channel,
    commitSha: resolvedCommitSha,
    buildNumber,
    builtAt: builtAt ?? new Date().toISOString(),
    sourceDirty: resolvedSourceDirty,
  });
  const tag = createDesktopBuildTag(buildInfo);
  if (expectedTag != null && expectedTag !== tag) {
    throw new Error(`Release tag ${expectedTag} must exactly match resolved build tag ${tag}.`);
  }

  const relativeBuildInfoPath = normalizeRepositoryRelativePath(root, buildInfoPath);
  const relativeBuilderConfigPath = normalizeRepositoryRelativePath(root, builderConfigPath);
  const targetDefinition = getDesktopTargetDefinition(target ?? createDesktopTargetFromNode());
  const builderConfig = createDesktopElectronBuilderConfig({
    packageMetadata,
    buildInfo,
    buildInfoPath: relativeBuildInfoPath,
    target: targetDefinition,
  });

  await writeJsonAtomic(path.join(root, relativeBuildInfoPath), buildInfo);
  await writeJsonAtomic(path.join(root, relativeBuilderConfigPath), builderConfig);

  return Object.freeze({
    buildInfo,
    buildInfoPath: relativeBuildInfoPath,
    builderConfig,
    builderConfigPath: relativeBuilderConfigPath,
    target: targetDefinition,
    tag,
    releaseName: createDesktopBuildReleaseName(buildInfo),
    artifactName: tag ? `puppyone-desktop-${tag}` : `puppyone-desktop-${buildInfo.version}`,
    r2Prefix: tag
      ? targetDefinition.platform === "macos"
        ? createDesktopBuildR2Prefix(buildInfo)
        : createDesktopImmutableReleasePrefix({
            releaseTag: tag,
            channel: buildInfo.channel,
            target: targetDefinition,
          })
      : null,
  });
}

export function createDesktopElectronBuilderConfig({
  packageMetadata,
  buildInfo,
  buildInfoPath = DEFAULT_BUILD_INFO_PATH,
  target,
}) {
  return createTargetDesktopElectronBuilderConfig({
    packageMetadata,
    buildInfo,
    buildInfoPath,
    target,
  });
}

export function readGitCommit(repositoryRoot) {
  const result = runGit(repositoryRoot, ["rev-parse", "HEAD"]);
  const commitSha = result.stdout.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commitSha)) {
    throw new Error("Git did not return a full commit SHA for the Desktop build.");
  }
  return commitSha;
}

export function readGitDirty(repositoryRoot) {
  return runGit(repositoryRoot, ["status", "--porcelain", "--untracked-files=normal"]).stdout.trim().length > 0;
}

function runGit(repositoryRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  return result;
}

function normalizeRepositoryRelativePath(root, value) {
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Generated Desktop build file must stay inside the repository: ${value}`);
  }
  return relative;
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}
